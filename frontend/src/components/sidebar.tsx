"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Calendar,
  Upload,
  BarChart3,
  Brain,
  History,
  LogOut,
  ClipboardList,
  UserCog,
  UserCircle,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth, getCurrentUser } from "@/lib/auth";
import { useRouter } from "next/navigation";

const NAV_PRINCIPAL = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ofertas", label: "Eventos SENAI", icon: ClipboardList },
  { href: "/professores", label: "Professores", icon: Users },
  { href: "/cursos", label: "Cursos", icon: BookOpen },
  { href: "/eventos", label: "Planejamento", icon: Calendar },
  { href: "/cronograma", label: "Cronograma", icon: Calendar },
  { href: "/importacao", label: "Importar Dados", icon: Upload },
  { href: "/regencia", label: "Regência", icon: TrendingUp },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/historico", label: "Histórico", icon: History },
  { href: "/ia", label: "Análise com IA", icon: Brain },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const me = getCurrentUser();
  const isAdmin = me?.perfil === "admin";

  function handleLogout() {
    clearAuth();
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-[#003B8E]">
      {/* Logo */}
      <div className="flex flex-col items-center px-5 py-4 border-b border-blue-700">
        <Image
          src="/senai-logo-white.png"
          alt="SENAI"
          width={160}
          height={56}
          className="object-contain"
          priority
        />
        <p className="text-blue-200 text-xs mt-1">Planejamento Acadêmico</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV_PRINCIPAL.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith(href)
                ? "bg-white/20 text-white"
                : "text-blue-200 hover:bg-white/10 hover:text-white"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}

        {/* Admin-only section */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-400">
                Administração
              </span>
            </div>
            <Link
              href="/usuarios"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/usuarios")
                  ? "bg-white/20 text-white"
                  : "text-blue-200 hover:bg-white/10 hover:text-white"
              )}
            >
              <UserCog className="h-4 w-4 shrink-0" />
              Usuários
            </Link>
          </>
        )}
      </nav>

      {/* Footer: user info + perfil + sair */}
      <div className="border-t border-blue-700 p-3 space-y-1">
        {me && (
          <Link
            href="/perfil"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              pathname.startsWith("/perfil")
                ? "bg-white/20 text-white"
                : "text-blue-200 hover:bg-white/10 hover:text-white"
            )}
          >
            <UserCircle className="h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium truncate leading-none">{me.nome}</p>
              <p className="text-[10px] text-blue-300 mt-0.5 truncate capitalize">{me.perfil}</p>
            </div>
          </Link>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-blue-200 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
