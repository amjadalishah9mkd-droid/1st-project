export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen">
      {/* Brand panel */}
      <aside className="relative hidden w-[44%] flex-col justify-between bg-surface-inverse p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            C
          </div>
          <span className="text-lg font-semibold tracking-tight text-ink-inverse">
            CampusOS
          </span>
        </div>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-ink-inverse">
            One platform for your entire campus.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-faint">
            Academics, attendance, assessment, fees and a private student
            community — unified for admins, teachers and students.
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          © {new Date().getFullYear()} CampusOS
        </p>
      </aside>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
