// Test the actual built bundle to verify WikilinkNode is invoked.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.DocumentFragment = dom.window.DocumentFragment;

const { default: React } = await import('react');
const { renderToString } = await import('react-dom/server');
const { default: ReactMarkdown } = await import('/Users/tshinjeii/oss/kite/dist/assets/markdown-C8TGjO_z.js').catch(() => null);
console.log('ReactMarkdown:', typeof ReactMarkdown);
