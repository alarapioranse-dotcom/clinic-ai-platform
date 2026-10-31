import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * renderToStaticMarkup cannot render async server components (layouts,
 * LanguageSwitcherSlot, NotFound). This test helper awaits every async
 * component in the tree first, then renders the result. Synchronous and
 * client components are left for React to render as usual.
 */
type AnyProps = { children?: ReactNode } & Record<string, unknown>;

async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<AnyProps>;
  const { type } = element;
  if (typeof type === 'function' && type.constructor.name === 'AsyncFunction') {
    return resolve(await (type as (props: AnyProps) => Promise<ReactNode>)(element.props));
  }
  if (element.props.children === undefined) return element;
  return cloneElement(element, undefined, await resolve(element.props.children));
}

export async function renderServer(node: ReactNode | Promise<ReactNode>): Promise<string> {
  return renderToStaticMarkup(await resolve(await node));
}
