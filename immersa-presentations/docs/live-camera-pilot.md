# Piloto IMMERSA LIVE

El piloto necesita una conferencia activa de Event Hub y una sola instancia del servidor. Speaker abre una previsualización local, selecciona cámara y envía video sin audio a la Pantalla designada. Stage muestra el estado y tiene un corte de emergencia.

## Configuración

### Desde Event Hub

La rama `agent/immersa-live-v1-prototype` permite que un administrador seleccione una única actividad en vivo en el servicio `immersa-presentations` de Railway Beta. En Event Hub, abrir el **Deck Check** de la actividad y pulsar **Preparar LIVE**. El botón crea tres enlaces dedicados para esa actividad. Abrir primero **Pantalla LIVE**, luego **Speaker LIVE** y **Stage LIVE**. Volver a pulsar el botón para recuperar los mismos enlaces. Esta modalidad usa la conexión directa y guarda la selección en el volumen de Beta. Para retirar el piloto de Beta, desplegar la rama normal de Beta. En otros despliegues puede habilitarse explícitamente para un slug mediante `IMMERSA_LIVE_CAMERA_SETUP_EVENT_SLUG` e `IMMERSA_LIVE_CAMERA_SETUP_ORIGIN`.

### Configuración manual

El piloto inicia apagado. Para ensayarlo en un entorno autorizado, configurar `IMMERSA_LIVE_CAMERA_PILOT` con el siguiente objeto JSON. Usar un Deck y tres enlaces vigentes de rol dedicados al ensayo. El enlace de Stage debe tener permiso de operador para ese escenario. Entregar los enlaces directamente a cada rol. Mantener los tokens y la clave de TURN en la configuración privada del servidor.

```json
{
  "origin": "https://beta.immersalive.com",
  "eventWorkspaceId": "EVENTO_DE_PRUEBA",
  "activityId": "ACTIVIDAD_DE_PRUEBA",
  "deckId": "DECK_DE_PRUEBA",
  "sessionId": "SESION_DEL_DECK",
  "links": {
    "speaker": "TOKEN_SPEAKER",
    "screen": "TOKEN_PANTALLA",
    "stage": "TOKEN_STAGE"
  },
  "stunUrls": ["stun:stun.example.com:3478"],
  "turnUrls": ["turns:turn.example.com:443?transport=tcp"],
  "forceRelay": false
}
```

`origin` debe ser el origen HTTPS exacto de las páginas. Para un ensayo en el mismo equipo se admite HTTP en localhost. `stunUrls` y `turnUrls` son opcionales para una prueba directa. Con TURN, configurar `IMMERSA_LIVE_CAMERA_TURN_SECRET` con el secreto compartido del relay compatible con TURN REST. `forceRelay: true` permite verificar el respaldo de red sin recurrir a una conexión directa.

## Ensayo

1. Abrir las tres páginas del piloto e iniciar la conferencia desde Stage.
2. En Speaker, abrir LIVE. Seleccionar trasera y frontal. Confirmar que Pantalla siga mostrando el slide durante la previsualización.
3. Pulsar **Enviar a Pantalla** y confirmar que Stage indique **En vivo**. Avanzar el Deck durante LIVE y confirmar que **Finalizar LIVE** revele ese slide.
4. Repetir y probar el corte desde Stage, el bloqueo del celular, el corte de red y el cierre de la conferencia. Después de un corte, abrir la cámara y enviar de nuevo manualmente.
5. Repetir en iPhone/Safari y Android/Chrome, en la red del recinto y con TURN forzado. Confirmar también el acceso de una sesión Individual y de otro evento.

Si Pantalla muestra video ligado, Audiovisual o FX, LIVE cede la proyección. Timer y reacciones conservan sus capas. La imagen de cámara ocupa el área de proyección respetando su proporción. La sesión LIVE es efímera. Para desactivar el piloto, retirar `IMMERSA_LIVE_CAMERA_PILOT` del entorno autorizado y reiniciar esa instancia. No requiere migraciones.
