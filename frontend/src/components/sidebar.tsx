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
  DoorOpen,
  CalendarDays,
  Clock3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth, getCurrentUser } from "@/lib/auth";
import { useRouter } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  perfis?: string[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão geral",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perfis: ["admin"] },
    ],
  },
  {
    label: "Acadêmico",
    items: [
      { href: "/cronograma",  label: "Cronograma",    icon: Calendar,      perfis: ["admin", "coordenador", "analista", "secretario", "professor"] },
      { href: "/ofertas",     label: "Eventos SENAI", icon: ClipboardList, perfis: ["admin", "coordenador", "analista", "secretario", "atendente", "consultor"] },
      { href: "/eventos",     label: "Planejamento",  icon: Calendar,      perfis: ["admin", "coordenador"] },
      { href: "/calendario",  label: "Calendário",    icon: CalendarDays,  perfis: ["admin", "coordenador"] },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { href: "/professores", label: "Professores", icon: Users,    perfis: ["admin", "coordenador", "analista"] },
      { href: "/cursos",      label: "Cursos",      icon: BookOpen, perfis: ["admin", "coordenador", "analista", "secretario", "atendente", "consultor"] },
      { href: "/ambientes",   label: "Salas e Labs", icon: DoorOpen, perfis: ["admin", "coordenador"] },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/regencia",     label: "Regência",        icon: TrendingUp, perfis: ["admin", "coordenador", "analista"] },
      { href: "/gestao-ponto", label: "Gestão de Ponto", icon: Clock3,     perfis: ["admin"] },
      { href: "/relatorios",   label: "Relatórios",      icon: BarChart3,  perfis: ["admin", "coordenador", "analista", "secretario"] },
      { href: "/historico",    label: "Histórico",       icon: History,    perfis: ["admin"] },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { href: "/importacao", label: "Importar Dados",  icon: Upload, perfis: ["admin"] },
      { href: "/ia",         label: "Análise com IA",  icon: Brain,  perfis: ["admin", "coordenador"] },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const me = getCurrentUser();
  const perfil: string = me?.perfil ?? "";
  const isAdmin = perfil === "admin";

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
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(
            (item) => !item.perfis || item.perfis.includes(perfil)
          );
          if (!visibleItems.length) return null;
          return (
            <div key={group.label} className="mb-4">
              <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-blue-400">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map(({ href, label, icon: Icon }) => (
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
              </div>
            </div>
          );
        })}

        {/* Admin-only: Usuários */}
        {isAdmin && (
          <div className="mb-4">
            <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-blue-400">
              Administração
            </p>
            <div className="space-y-0.5">
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
            </div>
          </div>
        )}
      </nav>

      {/* Footer: user info + sair */}
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
