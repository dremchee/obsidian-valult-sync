import { createApp, reactive, type App, type Component } from "vue";

export type MountedVueComponent = App<Element>;
export interface ReactiveMountedVueComponent<Props extends Record<string, unknown>> {
  app: MountedVueComponent;
  props: Props;
}

export function mountComponent<Props extends Record<string, unknown>>(
  component: Component,
  target: HTMLElement,
  props: Props,
): MountedVueComponent {
  const app = createApp(component, props);
  app.mount(target);
  return app;
}

export function mountReactiveComponent<Props extends Record<string, unknown>>(
  component: Component,
  target: HTMLElement,
  initialProps: Props,
): ReactiveMountedVueComponent<Props> {
  const props = reactive({ ...initialProps }) as Props;
  const app = mountComponent(component, target, props);
  return { app, props };
}

export async function destroyComponent(instance: MountedVueComponent | null): Promise<void> {
  if (!instance) {
    return;
  }

  instance.unmount();
}
