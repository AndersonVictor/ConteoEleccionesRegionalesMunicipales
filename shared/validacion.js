// Validaciones compartidas entre el formulario (navegador) y la API (servidor).
// Cada función devuelve un mensaje de error o null si el dato es válido.

/** Mayúsculas, sin espacios repetidos (así se escriben los nombres en el DNI y en la cédula). */
export const mayusculas = (s) => String(s ?? '').normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();

const LETRAS_NOMBRE = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ' .-]*$/;

export function errorNombre(valor, campo = 'El nombre', { opcional = false } = {}) {
  const v = mayusculas(valor);
  if (!v) return opcional ? null : `${campo} es obligatorio`;
  if (v.length < 2) return `${campo} es muy corto`;
  if (v.length > 60) return `${campo} es muy largo`;
  if (!LETRAS_NOMBRE.test(v)) return `${campo} solo puede tener letras`;
  return null;
}

export function errorDni(valor) {
  return /^\d{8}$/.test(String(valor ?? '')) ? null : 'El DNI debe tener 8 dígitos';
}

export function errorCelular(valor) {
  const v = String(valor ?? '').replace(/\s/g, '');
  if (!v) return 'El celular es obligatorio';
  return /^9\d{8}$/.test(v) ? null : 'El celular debe tener 9 dígitos y empezar con 9';
}

export function errorEmail(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return null; // opcional
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) && v.length <= 120 ? null : 'Correo inválido';
}

export function errorPassword(valor) {
  const v = String(valor ?? '');
  if (v.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Za-zÑñ]/.test(v) || !/\d/.test(v)) return 'La contraseña debe tener letras y números';
  return null;
}

export function errorNumeroMesa(valor) {
  return /^\d{6}$/.test(String(valor ?? '')) ? null : 'El número de mesa tiene 6 dígitos';
}

export const MAX_ELECTORES_MESA = 300;

export function errorElectores(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) return 'Ingresa los electores hábiles de la mesa';
  if (n > MAX_ELECTORES_MESA) return `Una mesa tiene como máximo ${MAX_ELECTORES_MESA} electores hábiles`;
  return null;
}

export function errorTextoLibre(valor, campo, max = 120) {
  const v = mayusculas(valor);
  if (v.length > max) return `${campo} es muy largo (máximo ${max} caracteres)`;
  if (/[<>{}]/.test(v)) return `${campo} tiene caracteres no permitidos`;
  return null;
}

export const nombreCompleto = (u) => mayusculas([u.nombres, u.apellido_paterno, u.apellido_materno].filter(Boolean).join(' '));
