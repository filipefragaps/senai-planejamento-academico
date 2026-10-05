"use client";

import { useState } from "react";
import { authApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { AlertTriangle, Eye, EyeOff, Loader2, Lock } from "lucide-react";

interface Props {
  titulo: string;
  descricao?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSenhaModal({ titulo, descricao, onConfirm, onCancel }: Props) {
  const [senha, setSenha] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleConfirm() {
    if (!senha) { setErro("Digite sua senha"); return; }
    const me = getCurrentUser();
    if (!me?.email) { setErro("Sessão inválida, faça login novamente"); return; }
    setVerificando(true);
    setErro("");
    try {
      await authApi.login(me.email, senha);
      onConfirm();
    } catch {
      setErro("Senha incorreta");
    } finally {
      setVerificando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg shrink-0 mt-0.5">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">{titulo}</h2>
            {descricao && <p className="text-xs text-gray-500 mt-1">{descricao}</p>}
          </div>
        </div>

        <p className="text-xs text-gray-600 mb-3">
          Esta ação é irreversível. Digite sua senha para confirmar:
        </p>

        <div className="relative mb-1">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type={mostrar ? "text" : "password"}
            placeholder="Sua senha"
            value={senha}
            autoFocus
            onChange={e => { setSenha(e.target.value); setErro(""); }}
            onKeyDown={e => e.key === "Enter" && !verificando && handleConfirm()}
            className="input w-full pl-9 pr-9"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setMostrar(o => !o)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {erro && <p className="text-xs text-red-600 mt-1 mb-2">{erro}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} disabled={verificando} className="flex-1 btn-secondary text-sm">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!senha || verificando}
            className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {verificando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
