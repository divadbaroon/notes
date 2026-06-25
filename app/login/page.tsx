"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  marginBottom: 12,
  border: "1px solid var(--card-border)",
  borderRadius: 6,
  background: "var(--card-bg)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  color: "var(--text)",
  outline: "none",
};

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setErr("Account created — confirm via the email we sent, then sign in.");
          setMode("signin");
          setBusy(false);
          return;
        }
        const { error: rErr } = await supabase.rpc("redeem_access_code", {
          p_code: code,
          p_username: username,
        });
        if (rErr) throw rErr;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push("/");
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <h1 style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 24, color: "var(--text)", margin: "0 0 4px" }}>
          Papert Lab wiki
        </h1>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-tertiary)", margin: "0 0 24px" }}>
          {mode === "signin" ? "Sign in to edit." : "Create an account with your access code."}
        </p>

        <form onSubmit={submit}>
          <input style={input} type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          {mode === "signup" && (
            <input style={input} type="text" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
          )}
          <input style={input} type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          {mode === "signup" && (
            <input style={input} type="text" placeholder="access code" value={code} onChange={(e) => setCode(e.target.value)} required />
          )}

          {err && (
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--clay)", margin: "2px 0 12px" }}>{err}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              padding: "11px 12px",
              border: "none",
              borderRadius: 6,
              background: "var(--accent)",
              color: "#f5f0e6",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button
          onClick={() => {
            setErr(null);
            setMode(mode === "signin" ? "signup" : "signin");
          }}
          style={{ marginTop: 16, background: "none", border: "none", color: "var(--accent)", fontFamily: "var(--font-sans)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>

        <div style={{ marginTop: 24 }}>
          <a href="/" style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-tertiary)", textDecoration: "none" }}>
            ← back to the wiki
          </a>
        </div>
      </div>
    </main>
  );
}
