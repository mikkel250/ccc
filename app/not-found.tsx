/** Fallback when no page route matches — directs callers to the API endpoints. */
export default function NotFound() {
  return (
    <main>
      <h1>404</h1>
      <p>CV Tailoring API — use POST /api/tailor-cv or GET /api/hello</p>
    </main>
  );
}
