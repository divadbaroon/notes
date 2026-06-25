export default function NotFound() {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ fontFamily: "var(--font-body)", color: "var(--text)" }}>Note not found</h1>
      <p style={{ color: "var(--text-muted)" }}>
        This note doesn’t exist yet.{" "}
        <a href="/evergreen" style={{ color: "var(--accent)" }}>
          Go home
        </a>
        .
      </p>
    </main>
  );
}
