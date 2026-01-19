import os
from datetime import datetime
from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from dotenv import load_dotenv

from db import Base, engine, get_db
from models import Appointment, Message

from twilio.rest import Client
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

load_dotenv()

app = FastAPI(title="Twilio Reminder Demo")

Base.metadata.create_all(bind=engine)

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")

twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

class AppointmentCreate(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=200)
    phone_e164: str = Field(..., min_length=8, max_length=32)
    scheduled_at: datetime

class SendReminderRequest(BaseModel):
    appointment_id: int

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/appointments")
def create_appointment(payload: AppointmentCreate, db: Session = Depends(get_db)):
    appt = Appointment(
        customer_name=payload.customer_name.strip(),
        phone_e164=payload.phone_e164.strip(),
        scheduled_at=payload.scheduled_at,
        status="scheduled",
        updated_at=datetime.utcnow(),
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    return {
        "id": appt.id,
        "customer_name": appt.customer_name,
        "phone_e164": appt.phone_e164,
        "scheduled_at": appt.scheduled_at.isoformat(),
        "status": appt.status,
    }

@app.get("/appointments")
def list_appointments(db: Session = Depends(get_db)):
    appts = db.query(Appointment).order_by(Appointment.scheduled_at.asc()).all()
    return [
        {
            "id": a.id,
            "customer_name": a.customer_name,
            "phone_e164": a.phone_e164,
            "scheduled_at": a.scheduled_at.isoformat(),
            "status": a.status,
            "last_inbound_text": a.last_inbound_text,
            "updated_at": a.updated_at.isoformat(),
        }
        for a in appts
    ]

@app.post("/send-reminder")
def send_reminder(payload: SendReminderRequest, db: Session = Depends(get_db)):
    appt = db.query(Appointment).filter(Appointment.id == payload.appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.status == "opt_out":
        raise HTTPException(status_code=400, detail="Customer opted out")

    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER):
        raise HTTPException(status_code=500, detail="Twilio env vars missing")

    # シンプルな文面（返信で1/2）
    body = (
        f"{appt.customer_name}様、予約リマインドです。\n"
        f"日時: {appt.scheduled_at.strftime('%Y-%m-%d %H:%M')}\n"
        "ご確認: 1 / 変更希望: 2 と返信してください。"
    )

    msg = twilio_client.messages.create(
        from_=TWILIO_FROM_NUMBER,
        to=appt.phone_e164,
        body=body,
    )

    db.add(Message(
        appointment_id=appt.id,
        direction="outbound",
        from_number=TWILIO_FROM_NUMBER,
        to_number=appt.phone_e164,
        body=body,
        twilio_sid=msg.sid,
    ))

    appt.status = "reminded"
    appt.updated_at = datetime.utcnow()
    db.commit()

    return {"sent": True, "twilio_sid": msg.sid, "appointment_id": appt.id}

def _validate_twilio_signature(request: Request, form: dict) -> None:
    """
    Twilioの署名検証（本番向けに必須）
    ngrok等でも動くように、URLは request.url をそのまま使う
    """
    signature = request.headers.get("X-Twilio-Signature", "")
    validator = RequestValidator(TWILIO_AUTH_TOKEN)
    url = str(request.url)
    if not validator.validate(url, form, signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

@app.post("/webhooks/twilio/sms")
async def twilio_inbound_sms(request: Request, db: Session = Depends(get_db)):
    form = dict(await request.form())

    # 署名検証（開発中に困るなら一時的にコメントアウト可）
    if TWILIO_AUTH_TOKEN:
        _validate_twilio_signature(request, form)

    from_number = (form.get("From") or "").strip()
    to_number = (form.get("To") or "").strip()
    body = (form.get("Body") or "").strip()

    # 受信メッセージ保存
    db_msg = Message(
        appointment_id=None,
        direction="inbound",
        from_number=from_number,
        to_number=to_number,
        body=body,
        twilio_sid=form.get("MessageSid"),
    )
    db.add(db_msg)

    # 最新の該当予約（電話番号一致・直近の予定を優先）
    appt = (
        db.query(Appointment)
        .filter(Appointment.phone_e164 == from_number)
        .order_by(Appointment.scheduled_at.desc())
        .first()
    )

    resp = MessagingResponse()

    normalized = body.upper().strip()

    if appt is None:
        resp.message("予約が見つかりませんでした。必要なら担当者にご連絡ください。")
        db.commit()
        return PlainTextResponse(str(resp), media_type="application/xml")

    db_msg.appointment_id = appt.id
    appt.last_inbound_text = body
    appt.updated_at = datetime.utcnow()

    if normalized in {"STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"}:
        appt.status = "opt_out"
        resp.message("配信停止を受け付けました。")
    elif normalized == "1":
        appt.status = "confirmed"
        resp.message("確認ありがとうございます。当日お待ちしております。")
    elif normalized == "2":
        appt.status = "reschedule"
        resp.message("変更希望を受け付けました。追ってご連絡します。")
    else:
        resp.message("返信は 1(確認) / 2(変更希望) でお願いします。配信停止は STOP です。")

    db.commit()
    return PlainTextResponse(str(resp), media_type="application/xml")
