"use client";

import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth";

/**
 * Usuário logado lido do localStorage só após montar no navegador.
 * Ler direto no render faz o HTML do servidor (sem usuário) divergir do cliente → erro de hidratação.
 * Retorna `undefined` enquanto não montou e `null` se não houver usuário.
 */
export function useCurrentUser() {
  const [me, setMe] = useState<any | null | undefined>(undefined);
  useEffect(() => { setMe(getCurrentUser()); }, []);
  return me;
}
