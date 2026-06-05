import ReactReconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants';
import type { RootContainer, SceneNode, BoxNode, TextNode, TextLeafNode, AnyNode, SvgNode } from '../scene/types';
import type { Style } from '../scene/style';

function nodeFromProps(type: string, props: Record<string, unknown>): SceneNode {
  if (type === 'box') {
    return {
      type: 'box',
      x: (props.x as number) ?? 0,
      y: (props.y as number) ?? 0,
      width: (props.width as number) ?? 0,
      height: (props.height as number) ?? 0,
      color: (props.color as string) ?? 'transparent',
      borderColor: props.borderColor as string | undefined,
      borderWidth: props.borderWidth as number | undefined,
      style: props.style as Style | undefined,
      children: [],
    } as BoxNode;
  }
  if (type === 'text') {
    const children = props.children;
    const text =
      typeof children === 'string' ? children :
      typeof children === 'number' ? String(children) :
      Array.isArray(children) ? children.join('') : '';
    return {
      type: 'text',
      x: (props.x as number) ?? 0,
      y: (props.y as number) ?? 0,
      color: (props.color as string) ?? 'white',
      fontSize: (props.fontSize as number) ?? 16,
      fontFamily: (props.fontFamily as string) ?? 'sans-serif',
      text,
      children: [],
    } as TextNode;
  }
  if (type === 'svg_image') {
    return {
      type: 'svg_image',
      x: (props.x as number) ?? 0,
      y: (props.y as number) ?? 0,
      width: (props.width as number) ?? 0,
      height: (props.height as number) ?? 0,
      src: (props.src as string) ?? '',
      style: props.style as Style | undefined,
      children: [],
    } as SvgNode;
  }
  throw new Error(`react-drm: unknown element type "${type}". Use <Box>, <Text>, or <Svg>.`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reconciler = ReactReconciler({
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  noTimeout: -1,

  now: Date.now,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  getRootHostContext: () => ({}),
  getChildHostContext: (parentCtx: unknown) => parentCtx,
  getPublicInstance: (instance: AnyNode) => instance,

  createInstance: (type: string, props: Record<string, unknown>) =>
    nodeFromProps(type, props),

  createTextInstance: (text: string) => {
    process.stderr.write(`react-drm: raw text "${text.trim()}" detected — wrap text in <Text>\n`);
    return { type: 'text-leaf', text, children: [] } as TextLeafNode;
  },

  appendInitialChild: (parent: AnyNode, child: AnyNode) => {
    if (parent.type === 'text-leaf') return;
    if (child.type === 'text-leaf') {
      if (parent.type === 'text') (parent as TextNode).text = child.text;
      return;
    }
    (parent as SceneNode).children.push(child as SceneNode);
  },

  finalizeInitialChildren: () => false,

  prepareUpdate: (
    _instance: AnyNode,
    _type: string,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ) => newProps,

  shouldSetTextContent: (type: string) => type === 'text',

  prepareForCommit: () => null,
  resetAfterCommit: (container: RootContainer) => {
    container._onCommit?.();
  },

  // Container mutations
  appendChildToContainer: (container: RootContainer, child: AnyNode) => {
    if (child.type !== 'text-leaf') container.children.push(child as SceneNode);
  },
  insertInContainerBefore: (container: RootContainer, child: AnyNode, before: AnyNode) => {
    if (child.type === 'text-leaf') return;
    const idx = container.children.indexOf(before as SceneNode);
    container.children.splice(idx === -1 ? 0 : idx, 0, child as SceneNode);
  },
  removeChildFromContainer: (container: RootContainer, child: AnyNode) => {
    const idx = container.children.indexOf(child as SceneNode);
    if (idx !== -1) container.children.splice(idx, 1);
  },

  // Instance mutations
  appendChild: (parent: AnyNode, child: AnyNode) => {
    if (parent.type === 'text-leaf' || child.type === 'text-leaf') return;
    (parent as SceneNode).children.push(child as SceneNode);
  },
  insertBefore: (parent: AnyNode, child: AnyNode, before: AnyNode) => {
    if (parent.type === 'text-leaf' || child.type === 'text-leaf') return;
    const arr = (parent as SceneNode).children;
    const idx = arr.indexOf(before as SceneNode);
    arr.splice(idx === -1 ? 0 : idx, 0, child as SceneNode);
  },
  removeChild: (parent: AnyNode, child: AnyNode) => {
    if (parent.type === 'text-leaf') return;
    const arr = (parent as SceneNode).children;
    const idx = arr.indexOf(child as SceneNode);
    if (idx !== -1) arr.splice(idx, 1);
  },

  commitUpdate: (
    instance: AnyNode,
    updatePayload: Record<string, unknown>,
    type: string,
  ) => {
    if (instance.type === 'text-leaf') return;
    const updated = nodeFromProps(type, updatePayload);
    const children = (instance as SceneNode).children;
    Object.assign(instance, updated);
    (instance as SceneNode).children = children;
  },

  commitTextUpdate: (instance: TextLeafNode, _old: string, newText: string) => {
    instance.text = newText;
  },

  commitMount: () => {},
  resetTextContent: () => {},
  clearContainer: (container: RootContainer) => { container.children = []; },
  detachDeletedInstance: () => {},
  hideInstance: () => {},
  hideTextInstance: () => {},
  unhideInstance: () => {},
  unhideTextInstance: () => {},

  getCurrentEventPriority: () => DefaultEventPriority,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  preparePortalMount: () => {},
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);
