# Reglamento Divisional "A" 2026 — Liga de Fútbol de Florida (resumen para el sistema)

Fuente: "Reglamento de disputa Campeonato Divisional A", LFF, temporada 2026 (PDF provisto por el cliente).
Solo se resumen los artículos que afectan el modelo de datos y el cálculo de tablas/fases.

- Apertura ("Julio Luengo"): 12 equipos, una rueda, todos contra todos. Inicio 25/07/2026.
- Clausura ("Ariosto López"): dos series de 6, una rueda. Composición según la tabla final del Apertura:
  Serie A = 1°, 4°, 5°, 7°, 9°, 11° · Serie B = 2°, 3°, 6°, 8°, 10°, 12°. Localías invertidas respecto del Apertura.
  Orden de cruces: "modelo tipo de OFI para torneos de seis" (no incluido en el PDF).
- Semifinales del Clausura: 1°A vs 2°B y 1°B vs 2°A. Partido único, local el 1° de serie. 90' + alargue + penales.
- Final del Clausura: ganadores de semifinales, cancha neutral, 90' + alargue + penales.
- Tabla Anual = Apertura + fase de series del Clausura (16 partidos). No incluye semifinales ni finales.
- Descenso: los dos de menor puntaje de la Tabla Anual (dos descienden a la B).
- Campeón de la temporada ("Hugo Angelero"), art. 5:
  A) mismo campeón de Apertura y Clausura → campeón de temporada.
  B) campeones distintos → partido final, cancha neutral, 90' + alargue + penales.
  C) si uno de los dos de (B) es además el 1° de la Tabla Anual, tiene derecho a una final extra si pierde (B).
  D) si el 1° de la Anual no es ninguno de los dos de (B), juega la final contra el ganador de (B).
- Desempates, art. 12:
  - Igualdad en el 1° puesto del Apertura o de la Tabla Anual, o en zona de descenso: partido extra (cancha neutral,
    90' + alargue + penales). Si empatan más de dos: juegan los dos con mejor DG, GF, fair play, sorteo
    (en descenso, los dos de peor saldo).
  - Otras posiciones (Apertura, series del Clausura, Anual): 1) diferencia de gol 2) goles a favor 3) fair play 4) sorteo.
- Clasificación a Copa Nacional de Clubes de OFI, art. 6: el campeón de la A + plazas restantes por Tabla Anual
  "con los corrimientos que determine OFI" (configurable por temporada).
- Postergaciones, art. 9: etapa completa → fin de semana siguiente; partidos sueltos → dentro de 72 h;
  por fuerza mayor → hasta dos semanas después.
- Tarjetas, art. 11: suspensión a las 3 amarillas; las finales no acumulan amarillas; expulsado → fecha siguiente.
- Horario oficial de las etapas de definición: 19:30.

Implicancias para el modelo:
- La plantilla "Apertura/Clausura" puede generar las series y el fixture del Clausura a partir de la tabla del Apertura.
- Semifinales, final del Clausura y finales de temporada son etapas cuyos participantes se definen por referencia
  ("1° Serie A", "ganador SF1", "campeón Apertura", "1° Tabla Anual") y algunas se juegan solo si se cumple una condición
  (casos B, C y D del art. 5).
- El criterio "fair play" requiere tarjetas; mientras no se carguen, queda como desempate manual.
