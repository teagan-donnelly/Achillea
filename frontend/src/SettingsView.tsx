import { Avatar, Screen, ScreenHeader, Section } from "./ui";
import { AlertList, ReplayBar } from "./replay";

/** Settings expose the demo's real workspace controls; there is no identity provider. */
export function SettingsView({
  label,
}: {
  label: string;
  unit: string;
  selectUnit: (unit: string, destination?: string) => void;
}) {
  return (
    <Screen className="st">
      <ScreenHeader title="Settings" />
      <Section title="Workspace">
        <div className="st-group">
          <div className="st-profile">
            <Avatar name="Jordan Ellis" />
            <span className="st-profile-text">
              <span className="st-profile-name">Jordan Ellis, RN</span>
              <span className="st-profile-unit">Demo nurse / {label}</span>
            </span>
          </div>
        </div>
      </Section>
      <Section title="Demo data">
        <ReplayBar tick={null} />
        <AlertList tick={null} showPatient includeResolved />
      </Section>
      <Section title="About">
        <dl className="st-group">
          <div className="st-row st-static">
            <dt>Environment</dt>
            <dd>Synthetic demo</dd>
          </div>
          <div className="st-row st-static">
            <dt>Version</dt>
            <dd>0.1.0</dd>
          </div>
        </dl>
        <p className="st-help">
          Patient access follows the demo nurse's assignments. Account
          authentication and notification preferences are not connected in this
          demo.
        </p>
      </Section>
    </Screen>
  );
}
