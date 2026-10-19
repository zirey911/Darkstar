export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-5 px-8">
      <p className="text-sm uppercase tracking-widest text-orange-300">Development environment</p>
      <h1 className="text-5xl font-semibold">Darkstar</h1>
      <p className="text-lg text-slate-300">Mars navigation and expedition-planning research.</p>
      <p className="text-slate-400">Infrastructure only. Mapping, routing, and mission simulations are not implemented.</p>
    </main>
  );
}
