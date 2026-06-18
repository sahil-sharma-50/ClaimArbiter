import { ArrowLeftRight, Server, ShieldCheck } from "lucide-react";
import { KeysForm } from "@/dashboard/components/platform/KeysForm";
import { PlatformPageBrief } from "@/dashboard/components/platform/PlatformPageBrief";
import { Icon } from "@/dashboard/components/ui/Icon";

const NOTICES = [
  {
    icon: ShieldCheck,
    label: "Local only",
    text: "Stored in this browser, sent with each run, never saved on the server. Clear them when you're finished.",
  },
  {
    icon: Server,
    label: "Your key wins",
    text: (
      <>
        A key you enter runs the claim. Leave one blank to fall back to the host&apos;s{" "}
        <code>.env</code>.
      </>
    ),
  },
  {
    icon: ArrowLeftRight,
    label: "Portable",
    text: (
      <>
        Copy a <code>.env</code> snippet to move config to a server.
      </>
    ),
  },
] as const;

export default function SettingsPage() {
  return (
    <div className="platform-page settings-page">
      <div className="platform-split-layout">
        <div className="platform-split-aside">
          <PlatformPageBrief
            kicker="Config"
            title="Provider credentials"
            sub="Add your own provider keys to run claims on your credentials."
          />

          <aside className="settings-notice" aria-label="How credentials work">
            {NOTICES.map(({ icon, label, text }) => (
              <div key={label} className="settings-notice-item">
                <span className="settings-notice-icon" aria-hidden>
                  <Icon as={icon} size={15} />
                </span>
                <div>
                  <p className="settings-notice-label">{label}</p>
                  <p className="settings-notice-text">{text}</p>
                </div>
              </div>
            ))}
          </aside>
        </div>

        <KeysForm />
      </div>
    </div>
  );
}
