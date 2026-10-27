"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/api";
import { api } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // CAPTCHA state
  const [captcha, setCaptcha] = useState<{ token: string; honeypot: { name: string; label: string } } | null>(null);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const mouseEventsRef = useRef<{ t: number; x: number; y: number }[]>([]);
  const mouseTrackerRef = useRef<() => void>(() => {});

  // Fetch a fresh CAPTCHA token on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/auth/captcha");
        if (cancelled) return;
        if (data.captcha === "disabled") {
          setCaptcha(null);
          setCaptchaVerified(true); // nothing to solve
          return;
        }
        setCaptcha({ token: data.token, honeypot: data.honeypot });
      } catch {
        setCaptcha(null);
        setCaptchaVerified(true); // fail open so login still works if captcha endpoint is down
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Mouse-movement behavioral proof (only while a captcha challenge is active).
  useEffect(() => {
    if (!captcha) {
      mouseTrackerRef.current = () => {};
      return;
    }
    const onMove = (e: MouseEvent) => {
      mouseEventsRef.current.push({ t: Date.now(), x: e.clientX, y: e.clientY });
      // Keep the buffer bounded.
      if (mouseEventsRef.current.length > 200) {
        mouseEventsRef.current = mouseEventsRef.current.slice(-200);
      }
    };
    window.addEventListener("mousemove", onMove);
    mouseTrackerRef.current = () => window.removeEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [captcha]);

  const resetCaptcha = useCallback(() => {
    setCaptchaVerified(false);
    setCaptchaError(null);
    mouseEventsRef.current = [];
    void (async () => {
      try {
        const { data } = await api.get("/auth/captcha");
        if (data.captcha === "disabled") {
          setCaptcha(null);
          setCaptchaVerified(true);
          return;
        }
        setCaptcha({ token: data.token, honeypot: data.honeypot });
      } catch {
        setCaptcha(null);
        setCaptchaVerified(true);
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCaptchaError(null);

    // CAPTCHA must be solved before submitting.
    if (captcha && !captchaVerified) {
      setCaptchaError("Please complete the \"I'm not a robot\" challenge.");
      return;
    }

    setLoading(true);
    try {
      await login(email, password, {
        token: captcha?.token ?? undefined,
        honeypot: "",
        mouse_events: captcha ? JSON.stringify(mouseEventsRef.current) : undefined,
      });
      router.replace("/");
    } catch (err: any) {
      const msg = await getErrorMessage(err);
      setError(msg);
      // CAPTCHA is one-time-use: on any failure, issue a fresh challenge.
      if (captcha) {
        resetCaptcha();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCaptchaChange = (checked: boolean) => {
    setCaptchaVerified(checked);
    setCaptchaError(null);
    if (checked) {
      mouseEventsRef.current = [];
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gh-canvas px-4 relative overflow-hidden">
      <div className="gh-orb gh-orb--blue" aria-hidden />
      <div className="gh-orb gh-orb--violet" aria-hidden />
      <div className="gh-orb gh-orb--green" aria-hidden />
      <div className="gh-orb gh-orb--amber" aria-hidden />
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gh-text">Branch Visit</h1>
          <p className="text-gh-faint text-sm mt-1">
            Inspection, Photo Evidence & Compliance Management
          </p>
        </div>
        <form onSubmit={handleSubmit} className="glass rounded-2xl p-6">
          <div className="mb-4">
            <label className="block text-xs font-medium text-gh-muted mb-1">Email</label>
            <input
              type="email"
              className="w-full border border-[#30363d] bg-gh-canvas text-gh-text rounded-lg px-3 py-2 text-sm placeholder:text-gh-faint focus:ring-2 focus:ring-[#2f81f7] focus:border-[#2f81f7] focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-gh-muted mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full border border-[#30363d] bg-gh-canvas text-gh-text rounded-lg pl-3 pr-10 py-2 text-sm placeholder:text-gh-faint focus:ring-2 focus:ring-[#2f81f7] focus:border-[#2f81f7] focus:outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gh-faint hover:text-gh-text focus:outline-none"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Honeypot: invisible trap for bots. Real users never see/fill it. */}
          {captcha && (
            <div style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}>
              <label htmlFor={captcha.honeypot.name}>{captcha.honeypot.label}</label>
              <input
                id={captcha.honeypot.name}
                name={captcha.honeypot.name}
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value=""
                onChange={() => setCaptchaError("Invalid submission.")}
              />
            </div>
          )}

          {/* CAPTCHA challenge */}
          {captcha && !captchaVerified && (
            <div className="mb-4 rounded-lg border border-[#30363d] bg-gh-canvas p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="captcha-checkbox"
                  checked={captchaVerified}
                  onChange={(e) => handleCaptchaChange(e.target.checked)}
                  className="rounded text-[#2f81f7] focus:ring-[#2f81f7]"
                  required
                />
                <label htmlFor="captcha-checkbox" className="text-sm text-gh-text cursor-pointer select-none">
                  I\u2019m not a robot
                </label>
              </div>
              {captchaError && <p className="text-[#f85149] text-xs mb-2">{captchaError}</p>}
              <button
                type="button"
                onClick={resetCaptcha}
                className="text-xs text-[#2f81f7] underline underline-offset-4 hover:text-[#1f6feb]"
              >
                Refresh challenge
              </button>
            </div>
          )}

          {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
          <button
            type="submit"
            disabled={loading || (captcha && !captchaVerified)}
            className="w-full bg-[#2f81f7] hover:bg-[#1f6feb] text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
