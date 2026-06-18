import { PlatformShell } from "@/dashboard/components/platform/PlatformShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
