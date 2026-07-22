"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { usuariosApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { Shield, BookOpen, Eye, CheckCircle2, KeyRound, User } from "lucide-react";

const PERFIL_INFO: Record<string, { label: string; descricao: string; icon: typeof Shield; color: string }> = {
  admin: {
    label: "Administrador",
    descricao: "Acesso total ao sistema: gerencia usuários, dados e configurações",
    icon: Shield,
    color: "text-red-600 bg-red-50 border-red-200",
  },
  coordenador: {
    label: "Coordenador",
    descricao: "Cria e edita planejamentos, eventos e professores",
    icon: BookOpen,
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  visualizador: {
    label: "Visualizador",
    descricao: "Acesso somente leitura ao cronograma e relatórios",
    icon: Eye,
    color: "text-gray-600 bg-gray-50 border-gray-200",
  },
};

export default function PerfilPage() {
  const me = getCurrentUser();
  const perfil = me?.perfil ?? "visualizador";
  const perfilInfo = PERFIL_INFO[perfil] ?? PERFIL_INFO.visualizador;
  const Icon = perfilInfo.icon;

  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmaSenha, setConfirmaSenha] = useState("");
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  const mutation = useMutation({
    mutationFn: () => usuariosApi.alterarSenha(senhaAtual, novaSenha),
    onSuccess: () => {
      setSucesso(true);
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmaSenha("");
      setErro("");
      setTimeout(() => setSucesso(false), 4000);
    },
    onError: (e: any) => {
      setErro(e.response?.data?.detail || "Erro ao alterar senha");
    },
  });

  function salvar() {
    setErro("");
    setSucesso(false);
    if (!senhaAtual) { setErro("Informe a senha atual"); return; }
    if (novaSenha.length < 6) { setErro("A nova senha deve ter pelo menos 6 caracteres"); return; }
    if (novaSenha !== confirmaSenha) { setErro("As senhas não conferem"); return; }
    mutation.mutate();
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Meu Perfil</h1>

      {/* Card de dados */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#003B8E]/10">
            <User className="h-7 w-7 text-[#003B8E]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold text-gray-900 truncate">{me?.nome ?? "—"}</p>
            <p className="text-sm text-gray-500 truncate">{me?.email ?? "—"}</p>
          </div>
          <div className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${perfilInfo.color}`}>
            <Icon className="h-4 w-4" />
            {perfilInfo.label}
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-500 border-t pt-4">{perfilInfo.descricao}</p>
      </div>

      {/* Alterar senha */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-2 mb-5">
          <KeyRound className="h-5 w-5 text-gray-400" />
          <h2 className="text-base font-semibold text-gray-900">Alterar Senha</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Senha atual</label>
            <input
              type="password"
              className="input w-full"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              placeholder="Digite sua senha atual"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Nova senha</label>
            <input
              type="password"
              className="input w-full"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Confirmar nova senha</label>
            <input
              type="password"
              className="input w-full"
              value={confirmaSenha}
              onChange={(e) => setConfirmaSenha(e.target.value)}
              placeholder="Repita a nova senha"
            />
          </div>
        </div>

        {erro && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>
        )}

        {sucesso && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Senha alterada com sucesso!
          </div>
        )}

        <div className="mt-5">
          <button
            onClick={salvar}
            disabled={mutation.isPending}
            className="rounded-lg bg-[#003B8E] px-5 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60 transition-colors"
          >
            {mutation.isPending ? "Salvando..." : "Alterar Senha"}
          </button>
        </div>
      </div>
    </div>
  );
}
