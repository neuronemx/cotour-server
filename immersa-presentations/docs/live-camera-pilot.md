# Piloto IMMERSA LIVE

El piloto necesita una conferencia activa de Event Hub y una sola instancia del servidor. Speaker abre una previsualización local, selecciona cámara y envía video sin audio a la Pantalla designada. Stage muestra el estado y tiene un corte de emergencia.

## Configuración

### Desde Event Hub

Un administrador puede seleccionar una única actividad en vivo en el servicio `immersa-presentations` del entorno Railway Beta de IMMERSA. En Event Hub, abrir el **Deck Check** de la actividad y pulsar **Preparar LIVE**. El botón crea tres enlaces dedicados para esa actividad. Abrir primero **Pantalla LIVE**, luego **Speaker LIVE** y **Stage LIVE**. Volver a pulsar el botón para recuperar los mismos enlaces. La primera pestaña que se conecta con el enlace **Pantalla LIVE** recibe la cámara. Para cambiar de equipo, cerrar esa pestaña y recargar **Pantalla LIVE** en el equipo nuevo. La selección se guarda en el volumen de Beta. El servicio recupera la selección al reiniciar. En otros despliegues autorizados puede habilitarse explícitamente para un slug mediante `IMMERSA_LIVE_CAMERA_SETUP_EVENT_SLUG` e `IMMERSA_LIVE_CAMERA_SETUP_ORIGIN`.

Para habilitar el respaldo de red, configurar `IMMERSA_LIVE_CAMERA_SETUP_TURN_URLS` con las URLs del relay separadas por comas y `IMMERSA_LIVE_CAMERA_TURN_SECRET` con su secreto compartido compatible con TURN REST. Por ejemplo, `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:443?transport=tcp`. Al reiniciar se aplican al evento ya configurado y se conservan sus enlaces. WebRTC puede elegir entre la conexión directa y el relay. Al retirar `IMMERSA_LIVE_CAMERA_SETUP_TURN_URLS` y reiniciar, el piloto vuelve a usar su configuración guardada.

### Configuración manual

Para ensayarlo con una selección explícita en un entorno autorizado, configurar `IMMERSA_LIVE_CAMERA_PILOT` con el siguiente objeto JSON. Usar un Deck y tres enlaces vigentes de rol dedicados al ensayo. El enlace de Stage debe tener permiso de operador para ese escenario. Entregar los enlaces directamente a cada rol. Mantener los tokens y la clave de TURN en la configuración privada del servidor.

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

Si Pantalla muestra video ligado, Audiovisual o FX, LIVE cede la proyección. Timer y reacciones conservan sus capas. La imagen de cámara ocupa el área de proyección respetando su proporción. La sesión LIVE es efímera. Para desactivar LIVE, fijar `IMMERSA_LIVE_CAMERA_ENABLED=false` y reiniciar la instancia. La configuración guardada y sus enlaces quedan disponibles para reactivarlo. No requiere migraciones.
