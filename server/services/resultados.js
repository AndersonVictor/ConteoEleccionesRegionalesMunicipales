// Servicio de resultados: el dashboard consolidado. Es de solo lectura y se puede escalar
// con tantas réplicas como haga falta (el cálculo se comparte por caché).
import { Router } from 'express';
import { describir } from '../lib/ubigeo.js';
import { calcularDashboard } from '../lib/resultados.js';
import { fallar, h, requiereLogin } from '../lib/http.js';
import { SECCIONES } from '../../shared/acta.js';

export function rutasResultados({ db }) {
  const r = Router();
  r.get('/api/dashboard', requiereLogin, h(async (req, res) => {
    const ubigeo = String(req.query.ubigeo || '');
    if (!describir(ubigeo)) fallar(400, 'Ámbito inválido');
    const seccion = req.query.seccion ? String(req.query.seccion) : null;
    if (seccion && !SECCIONES[seccion]) fallar(400, 'Sección inválida');
    res.set('Cache-Control', 'private, max-age=5');
    res.json(await calcularDashboard(db, { ubigeo, seccion, incluirBorradores: req.query.borradores === '1' }));
  }));
  return r;
}
