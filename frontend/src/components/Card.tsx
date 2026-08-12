export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200/70 bg-white p-4 shadow-card lg:rounded-[22px] lg:p-5">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      {children}
    </section>
  )
}
