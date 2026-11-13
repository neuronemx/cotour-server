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


## Cloudflare TURN en Beta

Configurar `IMMERSA_CLOUDFLARE_TURN_KEY_ID` y `IMMERSA_CLOUDFLARE_TURN_API_TOKEN` en el servicio de Beta. Con esas variables, el servidor solicita credenciales temporales a Cloudflare antes de cada intento autorizado de LIVE. La clave de API permanece en el servidor. Las credenciales temporales duran 24 horas para cubrir una intervención prolongada.

Sin estas variables se conserva el transporte anterior. Si se configura solo una, o Cloudflare rechaza la solicitud, el inicio falla con el aviso de servicio y libera la reserva para reintentar. Al arrancar, el servidor comprueba la generación de credenciales y registra únicamente el resultado, sin secretos. Esa comprobación verifica la API, no la entrega de video.

Para validar el relay, usar `IMMERSA_LIVE_CAMERA_FORCE_RELAY=true`. Para probar exclusivamente TURN sobre TLS/443, usar `IMMERSA_LIVE_CAMERA_TURN_TLS_ONLY=true`, que también fuerza relay. Reiniciar el servicio al cambiar estas variables. Con ambos navegadores recargados, transmitir video y verificar el corte, cambio de cámara y regreso al slide. Probar luego entre redes diferentes. Tras validar, fijar ambas variables en `false` para que WebRTC elija automáticamente la ruta directa o TURN.


## Invitados LIVE, primer hito en Beta

Activar `IMMERSA_LIVE_GUESTS_ENABLED=true` en Beta para habilitar un invitado por Deck y sesión en los enlaces normales de Stage y Pantalla. Requiere Cloudflare TURN. La función está apagada por defecto y depende del entorno permitido para LIVE de Decks de trabajo.

En Stage, abrir **Invitados LIVE**, escribir el nombre y crear el enlace. Cada enlace dura 24 horas y sustituye el anterior de ese Deck y sesión. El invitado abre el enlace y pulsa **Entrar** para autorizar cámara, micrófono y sonido. Desde ese momento solo ve su monitor y los estados **EN ESPERA**, **EN VIVO** y **ENLACE TERMINADO**.

Para el ensayo, usar Stage con audífonos en un equipo distinto al de Pantalla. En Stage, seleccionar **Micrófono de producción** y **Audio del escenario**, y pulsar **Activar / actualizar audio**. La entrada del escenario debe ser el retorno de consola que excluye la voz del invitado. En Pantalla, activar el audio una vez con el botón compartido de sonido. El audio de Pantalla sale por el sistema del evento.

Con el invitado conectado, pulsar **Preparar conexión**. Stage recibe el monitor y conversa en privado con el invitado. **Enviar a Pantalla** prepara la salida y espera a que Pantalla decodifique video y reciba audio antes de ponerla al aire. El retorno al invitado cambia del micrófono de producción al audio del escenario. Stage puede silenciar y terminar el enlace. Al terminar, se detiene la cámara del invitado y Pantalla recupera el contenido vigente.

El invitado envía una señal de audio y video a Stage. Stage la reenvía a Pantalla por una segunda conexión WebRTC. Stage debe permanecer abierto durante la intervención. Cerrar su panel permite seguir operando el Deck. Una reserva compartida evita la simultaneidad con LIVE del Speaker. La pérdida de un participante corta la salida y exige preparar y dar entrada de nuevo. La autorización se revalida periódicamente y Pantalla mantiene un temporizador local para retirar video y audio si dejan de llegar renovaciones o fotogramas.

El estado al aire es efímero. Los enlaces se guardan mediante escritura atómica en `data/live-guests/`. Al finalizar la presentación, el enlace conectado se marca terminado. Para repetir una intervención finalizada se crea un enlace nuevo. Para desactivar el piloto, fijar `IMMERSA_LIVE_GUESTS_ENABLED=false` y desplegar.

La primera validación cubre un invitado, producción y Pantalla. La vista del slide, las reacciones y las preguntas seleccionadas para el invitado corresponden al siguiente hito.
