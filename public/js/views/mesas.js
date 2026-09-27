import { actaLocal, api, local, sesion } from '../api.js';
import { SECCIONES } from '/shared/acta.js';
import { botonAyuda, cargando, fmt, html, iconos, titulo, toast } from '../ui.js';
import { guia } from '../guia.js';

export async function vistaMesas(app) {
  app.innerHTML = String(cargando());
  let actas = [];
  try {
    ({ actas } = await api('/actas'));
  } catch (e) {
    // Sin señal: se muestran las mesas guardadas en el celular.
    actas = local.claves('acta:').map((k) => local.get(k)?.acta).filter(Boolean).map((a) => ({
      id: a.id, estado: a.estado, cuadra: a.cuadra, cedulas: a.registros.length, mesa: a.mesa,
    }));
    toast(e.status === 0 ? 'Sin conexión: mostrando mesas guardadas en el celular' : e.message, { error: e.status !== 0 });
  }
  const u = sesion.usuario;
  app.innerHTML = String(html`
    <div class="encabezado">
      <div class="titulos">
        <h1>Mis mesas</h1>
        <div class="sub">Hola, ${titulo(u?.nombre?.split(' ')[0] || '')}. ${actas.length ? 'Toca una mesa para seguir contando.' : 'Registra la mesa donde eres personero.'}</div>
      </div>
      ${botonAyuda('mesas')}
      <a class="btn primario chico" href="#/mesa/nueva" data-guia="nueva-mesa">${iconos.mas} Mesa</a>
    </div>
    ${actas.length
      ? html`<div class="stack" data-guia="lista-mesas">${actas.map((a) => {
          const l = actaLocal(a.id);
          const cedulas = l?.acta?.registros?.length ?? a.cedulas;
          const pendiente = l?.pendiente;
          const avance = a.mesa.electores_habiles ? Math.min(100, (100 * cedulas) / a.mesa.electores_habiles) : 0;
          return html`<a class="card mesa-item" href="#/acta/${a.id}${a.estado === 'cerrada' ? '/resumen' : ''}">
            <div class="mesa-num"><div><small>MESA</small>${a.mesa.numero}</div></div>
            <div class="grow">
              <div class="row between">
                <b class="ellipsis">${titulo(a.mesa.distrito)}</b>
                ${a.estado === 'cerrada'
                  ? html`<span class="chip ${a.cuadra ? 'ok' : 'warn'}">${a.cuadra ? 'Cerrada' : 'Cerrada con obs.'}</span>`
                  : html`<span class="chip acc">En conteo</span>`}
              </div>
              <div class="small muted ellipsis">${titulo(a.mesa.provincia)}, ${titulo(a.mesa.departamento)}${a.mesa.local_votacion ? ` · ${a.mesa.local_votacion}` : ''}</div>
              <div class="small" style="margin-top:4px"><b class="num">${fmt(cedulas)}</b> cédulas contadas de ${fmt(a.mesa.electores_habiles)} electores
                ${pendiente ? html`<span class="chip warn" style="margin-left:4px">Por enviar</span>` : ''}</div>
              <div class="progreso"><i style="width:${avance}%"></i></div>
            </div>
          </a>`;
        })}</div>`
      : html`<div class="card vacio">
          ${iconos.urna}
          <h2 style="color:var(--ink)">Aún no tienes mesas</h2>
          <p>Registra tu mesa con el número que figura en el acta. Luego cuentas cada cédula con un toque.</p>
          <a class="btn primario" href="#/mesa/nueva">Registrar mi mesa</a>
        </div>`}
    <div class="card stack" style="margin-top:20px">
      <h3>¿Cómo funciona?</h3>
      <ol class="small" style="margin:0;padding-left:20px;color:var(--ink-2)">
        <li>Registra tu mesa (número, distrito y electores hábiles).</li>
        <li>Durante el escrutinio, por cada cédula marca la opción de cada elección: ${Object.values(SECCIONES).map((s) => s.corto.toLowerCase()).join(', ')}.</li>
        <li>Al final, ingresa cuántos ciudadanos votaron y revisa que todo cuadre.</li>
        <li>Cierra el acta: tu resultado se suma al consolidado de la región, provincia y distrito.</li>
      </ol>
    </div>`);
  guia('mesas');
}
