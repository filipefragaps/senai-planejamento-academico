"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { GraduationCap } from "lucide-react";
import { authApi } from "@/lib/api";
import { setToken } from "@/lib/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErro(null);
    try {
      const data = await authApi.login(email, senha);
      setToken(data.access_token, {
        nome: data.usuario_nome,
        email: data.usuario_email,
        perfil: data.perfil,
      });
      const redirect = searchParams.get("redirect") || "/dashboard";
      router.push(redirect);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ||
        (err?.response?.status === 401 ? "Email ou senha incorretos." : "Erro ao conectar. Tente novamente.");
      setErro(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {erro && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setErro(null); }}
          className={`input w-full ${erro ? "border-red-400 focus:ring-red-400" : ""}`}
          placeholder="seu@email.com"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
        <input
          type="password"
          value={senha}
          onChange={(e) => { setSenha(e.target.value); setErro(null); }}
          className={`input w-full ${erro ? "border-red-400 focus:ring-red-400" : ""}`}
          placeholder="••••••••"
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full mt-2"
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#003B8E] to-[#0057D4]">
      <div className="w-full max-w-md">
        <div className="card p-8 shadow-xl">
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[#003B8E] mb-4">
              <GraduationCap className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">SENAI</h1>
            <p className="text-sm text-gray-500 text-center mt-1">
              Sistema de Planejamento Acadêmico
            </p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
