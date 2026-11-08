"use client";
import { useState, type FormEvent } from "react";
import { ArrowLeft, AudioLines, Eye, EyeOff, Headphones } from "lucide-react";
import { api, post, errorText } from "@/lib/api";
import Artwork from "@/components/artwork";
export default function Login() {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [visible, setVisible] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError("");
    try {
      await api(
        "/api/auth/login",
        post({ name: form.get("name"), password: form.get("password") }),
      );
      location.replace("/");
    } catch (e) {
      setError(errorText(e));
      setPending(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-story">
        <a className="brand" href="/login">
          <AudioLines />
          <span>
            موزیک‌روم<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="login-art">
          <Artwork large />
          <span className="floating-label">
            <Headphones size={18} /> یک اتاق، هزار سلیقه
          </span>
        </div>
        <h1>
          آهنگ‌ها قشنگ‌ترن،
          <br />
          <em>وقتی با هم می‌شنویم.</em>
        </h1>
        <p>موسیقی موردعلاقه‌ات را بیاور؛ باقی‌اش با جمع.</p>
        <span className="tiny-label">YOUR PEOPLE. YOUR MUSIC. YOUR ROOM.</span>
      </section>
      <section className="login-form-wrap">
        <div className="login-form">
          <span className="eyebrow">خوش برگشتی</span>
          <h2>بیا توی اتاق.</h2>
          <p className="muted">با حسابی که مدیر اتاق برایت ساخته وارد شو.</p>
          <form onSubmit={submit}>
            <label htmlFor="name">نام کاربری</label>
            <input
              id="name"
              name="name"
              autoComplete="username"
              required
              maxLength={40}
              placeholder="نام کاربری شما"
            />
            <label htmlFor="password">رمز عبور</label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
                maxLength={128}
                placeholder="رمز عبور شما"
              />
              <button
                type="button"
                className="icon-button"
                aria-label={visible ? "پنهان کردن رمز" : "نمایش رمز"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff /> : <Eye />}
              </button>
            </div>
            <p role="alert" className="error-text">
              {error}
            </p>
            <button className="primary full" disabled={pending}>
              {pending ? "در حال ورود…" : "ورود به موزیک‌روم"}
              <ArrowLeft size={18} />
            </button>
          </form>
          <p className="login-help">
            هنوز حساب نداری؟ از مدیر اتاق بخواه برایت بسازد.
          </p>
        </div>
        <span className="login-footer">جایی برای شنیدن و کنار هم بودن.</span>
      </section>
    </main>
  );
}
