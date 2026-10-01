// Tema claro / oscuro / automático (sigue al celular). Se recuerda en el dispositivo.
import { local } from './api.js';

const META = () => document.querySelector('meta[name=theme-color]');

export function temaActual() {
  return local.get('tema', 'auto');
}

export function aplicarTema(tema = temaActual()) {
  const raiz = document.documentElement;
  if (tema === 'auto') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', tema);
  const oscuro = tema === 'dark' || (tema === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  META()?.setAttribute('content', oscuro ? '#151413' : '#b91c2c');
}

export function cambiarTema(tema) {
  local.set('tema', tema);
  aplicarTema(tema);
}

/** Alterna claro/oscuro desde el botón rápido. */
export function alternarTema() {
  const oscuro = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  cambiarTema(oscuro ? 'light' : 'dark');
}
