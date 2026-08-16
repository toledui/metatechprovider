import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="THagencia Tech Provider">
      <span className="brand-mark">TH</span>
      <span>
        <strong>THagencia</strong>
        <small>Tech Provider</small>
      </span>
    </Link>
  );
}
