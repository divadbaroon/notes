"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function ensureMembershipAndGo() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (!prof) {
      if (!username.trim() || !code.trim())
        throw new Error("Enter a username and access code to start editing.");
      const { error } = await supabase.rpc("redeem_access_code", {
        p_code: code.trim(),
        p_username: username.trim(),
      });
      if (error) throw error;
    }
    router.push("/");
    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    setBusy(true);
    try {
      // Try to sign in; if the account doesn't exist yet, create it (email auto-confirmed).
      let res = await supabase.auth.signInWithPassword({ email, password });
      if (res.error) {
        const { error: upErr } = await supabase.auth.signUp({ email, password });
        if (upErr && !/already/i.test(upErr.message)) throw upErr;
        res = await supabase.auth.signInWithPassword({ email, password });
        if (res.error) throw res.error;
      }
      await ensureMembershipAndGo();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "var(--font-sans)", maxWidth: 320, margin: "80px auto", padding: "0 20px" }}>
      <h1 style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontWeight: 400, fontSize: 22 }}>
        Papert Lab wiki
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
        Sign in, or create an account with your access code.
      </p>

      <form onSubmit={onSubmit}>
        <p>
          <label>
            email<br />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            password<br />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            username<br />
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: "100%" }} />
          </label>
        </p>
        <p>
          <label>
            access code<br />
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} style={{ width: "100%" }} />
          </label>
        </p>

        {msg && <p style={{ color: "var(--clay)", fontSize: 13 }}>{msg}</p>}

        <p>
          <button type="submit" disabled={busy}>{busy ? "…" : "Continue"}</button>
          {"  "}
          <a href="/" style={{ fontSize: 13 }}>back to the wiki</a>
        </p>
      </form>

      <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        New here? Just fill in all four fields. Returning? Email + password is enough.
      </p>
    </main>
  );
}
