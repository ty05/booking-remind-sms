"use client";

import { useEffect, useMemo, useState } from "react";

type Appointment = {
  id: number;
  customer_name: string;
  phone_e164: string;
  scheduled_at: string;
  status: string;
  last_inbound_text?: string | null;
  updated_at: string;
};

async function backendGET(path: string) {
  const res = await fetch(`/api/backend?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function backendPOST(path: string, payload: any) {
  const res = await fetch(`/api/backend?path=${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function Page() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [name, setName] = useState("Taro");
  const [phone, setPhone] = useState("+81");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    return d.toISOString().slice(0, 16); // for datetime-local
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => {
    return [...appointments].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }, [appointments]);

  async function refresh() {
    setError(null);
    const data = await backendGET("/appointments");
    setAppointments(data);
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await backendPOST("/appointments", {
        customer_name: name,
        phone_e164: phone,
        scheduled_at: new Date(scheduledAt).toISOString(),
      });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendReminder(id: number) {
    setBusy(true);
    setError(null);
    try {
      await backendPOST("/send-reminder", { appointment_id: id });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Twilio 予約リマインド（双方向SMS）デモ</h1>

      <section style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>予約を作成</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" style={{ padding: 10, border: "1px solid #ccc", borderRadius: 10 }} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+81..." style={{ padding: 10, border: "1px solid #ccc", borderRadius: 10 }} />
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ padding: 10, border: "1px solid #ccc", borderRadius: 10 }} />
          <button disabled={busy} onClick={create} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #333", cursor: "pointer" }}>
            作成
          </button>
        </div>
        {error && <p style={{ marginTop: 12, color: "crimson" }}>{error}</p>}
      </section>

      <section style={{ marginTop: 24 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>予約一覧</h2>
          <button disabled={busy} onClick={() => refresh()} style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #333", cursor: "pointer" }}>
            更新
          </button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 10 }}>ID</th>
              <th style={{ padding: 10 }}>顧客</th>
              <th style={{ padding: 10 }}>電話</th>
              <th style={{ padding: 10 }}>日時</th>
              <th style={{ padding: 10 }}>状態</th>
              <th style={{ padding: 10 }}>最終返信</th>
              <th style={{ padding: 10 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 10 }}>{a.id}</td>
                <td style={{ padding: 10 }}>{a.customer_name}</td>
                <td style={{ padding: 10 }}>{a.phone_e164}</td>
                <td style={{ padding: 10 }}>{new Date(a.scheduled_at).toLocaleString()}</td>
                <td style={{ padding: 10 }}>{a.status}</td>
                <td style={{ padding: 10 }}>{a.last_inbound_text ?? "-"}</td>
                <td style={{ padding: 10 }}>
                  <button
                    disabled={busy || a.status === "opt_out"}
                    onClick={() => sendReminder(a.id)}
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #333", cursor: "pointer" }}
                  >
                    リマインド送信
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 12, color: "#666" }}>
                  まだ予約がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
