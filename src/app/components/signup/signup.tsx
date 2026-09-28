"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, AuthUser, saveSession } from "@/app/lib/api";
import AuthShell from "@/app/components/auth/auth-shell";

export default function Signup() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!companyName.trim() || !email.trim() || !password.trim()) {
      setError("Company name, email, and password are required.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const result = await api<{ token: string; user: AuthUser }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ companyName, email, password }),
      });
      saveSession(result.token, result.user);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="flex w-full max-w-md flex-col justify-center rounded-3xl border border-white/70 bg-white/85 px-9 py-11 shadow-[0_24px_70px_rgba(2,16,18,0.35)] backdrop-blur-2xl">
        <p className="text-sm font-semibold tracking-[0.18em] text-[#163532] uppercase">
          Aibot
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-[#122825]">Create account</h2>
        <p className="mt-2 text-sm font-medium text-[#1c3d39]">
          Sign up as a business owner to get your chatbot widget.
        </p>

        <form className="mt-10 space-y-6" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[#163532]">Company name</span>
            <input
              type="text"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Acme Store"
              className="w-full rounded-lg border border-[#163532]/20 bg-white px-3 py-2.5 text-sm text-[#122825] outline-none transition placeholder:text-slate-400 focus:border-[#163532] focus:ring-2 focus:ring-[#163532]/15"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[#163532]">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-[#163532]/20 bg-white px-3 py-2.5 text-sm text-[#122825] outline-none transition placeholder:text-slate-400 focus:border-[#163532] focus:ring-2 focus:ring-[#163532]/15"
            />
          </label>

          <div className="block">
            <label htmlFor="signup-password" className="mb-2 block text-sm font-medium text-[#163532]">
              Password
            </label>
            <div className="relative">
              <input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-lg border border-[#163532]/20 bg-white px-3 py-2.5 pr-16 text-sm text-[#122825] outline-none transition placeholder:text-slate-400 focus:border-[#163532] focus:ring-2 focus:ring-[#163532]/15"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-medium text-[#163532]"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#163532] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#0f2724] disabled:opacity-60"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-8 text-center text-sm font-medium text-[#1c3d39]">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-[#163532] underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
