'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Brand } from './brand';
import { Orbit } from './illustrations';
import { api } from '@/lib/client';
export function AuthForm() {
  const params = useSearchParams(),
    router = useRouter();
  const [register, setRegister] = useState(params.get('mode') === 'register'),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    api('auth/me')
      .then(() => router.replace('/hub'))
      .catch(() => {});
  }, [router]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      await api(`auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: {
          email: String(data.get('email')),
          password: String(data.get('password')),
          ...(register ? { name: String(data.get('name')) } : {}),
        },
      });
      router.push('/hub');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tidak dapat masuk. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="auth-page">
      <aside className="auth-aside">
        <Brand dark />
        <div>
          <span className="eyebrow">A PLACE FOR YOUR MOMENTS</span>
          <h1>
            Yang singkat,
            <br />
            bisa tetap
            <br />
            <em>dekat.</em>
          </h1>
          <p>
            Satu workspace pribadi.
            <br />
            Untuk momen yang layak disimpan.
          </p>
        </div>
        <Orbit compact />
        <span className="auth-footnote">
          <ShieldCheck size={16} />
          Kredensial sesi dienkripsi saat tersimpan.
        </span>
      </aside>
      <section className="auth-main">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Kembali ke beranda
        </Link>
        <div className="auth-card">
          <span className="eyebrow">IM STATUS HUB</span>
          <h2>{register ? 'Ruang baru untuk Anda.' : 'Selamat datang kembali.'}</h2>
          <p>
            {register
              ? 'Buat akun workspace Anda. WhatsApp ditautkan setelah masuk.'
              : 'Masuk ke workspace dan lanjutkan koleksi Anda.'}
          </p>
          <div className="auth-tabs" role="tablist" aria-label="Akses workspace">
            <button
              role="tab"
              aria-selected={!register}
              onClick={() => {
                setRegister(false);
                setError('');
              }}
            >
              Masuk
            </button>
            <button
              role="tab"
              aria-selected={register}
              onClick={() => {
                setRegister(true);
                setError('');
              }}
            >
              Buat akun
            </button>
          </div>
          <form onSubmit={submit}>
            {register && (
              <label>
                Nama
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Nama Anda"
                  required
                  minLength={2}
                  maxLength={60}
                />
              </label>
            )}
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="nama@email.com"
                required
                maxLength={254}
              />
            </label>
            <label>
              Kata sandi
              <div className="password-input">
                <input
                  type={visible ? 'text' : 'password'}
                  name="password"
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder="Minimal 12 karakter"
                  minLength={12}
                  maxLength={128}
                  required
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-dark full" disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {busy ? 'Memproses…' : register ? 'Buat workspace' : 'Masuk ke workspace'}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-note">
            <LockKeyhole size={15} />
            Kami tidak meminta OTP WhatsApp untuk masuk.
          </p>
        </div>
        <p className="auth-bottom">Hanya untuk akun Anda atau akun yang Anda kelola dengan izin.</p>
      </section>
    </main>
  );
}
