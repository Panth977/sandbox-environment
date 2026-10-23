import { CUSTOM_ELEMENTS_SCHEMA, Component, NgZone, OnInit } from "@angular/core";
import { NgFor, NgIf } from "@angular/common";
import "@panth977/sandbox/element"; // defines <sbx-artifact>
import { compile } from "@panth977/sandbox/compiler";
import type { CompiledArtifact, Theme } from "@panth977/sandbox/host";
import { SOURCES } from "./artifacts";

type Kind = keyof typeof SOURCES;

@Component({
  selector: "app-root",
  standalone: true,
  imports: [NgFor, NgIf],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <h1>Angular {{ version }} host</h1>
    <p>Total from all artifacts: <b id="total">{{ total }}</b></p>
    <section *ngFor="let k of kinds" [attr.data-kind]="k" style="margin: 12px 0">
      <h2 style="font-size: 15px">{{ k }}</h2>
      <p *ngIf="errors[k]" class="error">{{ errors[k] }}</p>
      <sbx-artifact *ngIf="artifacts[k] as a" [artifact]="a" [api]="api" [theme]="theme"
        (sbx-ready)="ready[k] = true" (sbx-error)="errors[k] = $any($event).detail.message"></sbx-artifact>
      <span class="ready" *ngIf="ready[k]">ready</span>
    </section>`,
})
export class AppComponent implements OnInit {
  readonly version = "15";
  readonly kinds: Kind[] = ["js", "react", "svelte"];
  artifacts: Partial<Record<Kind, CompiledArtifact>> = {};
  ready: Partial<Record<Kind, boolean>> = {};
  errors: Partial<Record<Kind, string>> = {};
  total = 0;
  theme: Theme = { mode: "light" };

  /** What every artifact can call as `host.*`, with the host app's own logic. */
  readonly api = {
    user: async () => ({ name: "Angular" }),
    counter: {
      add: async (n: number) => {
        // calls arrive outside Angular's zone in some browsers: re-enter it so the view updates
        return this.zone.run(() => (this.total += n));
      },
    },
  };

  constructor(private zone: NgZone) {}

  async ngOnInit() {
    for (const k of this.kinds) {
      const r = await compile(SOURCES[k]);
      if (r.ok && r.artifact) this.artifacts = { ...this.artifacts, [k]: r.artifact };
      else this.errors[k] = r.diagnostics.map((d) => d.message).join("; ");
    }
  }
}
