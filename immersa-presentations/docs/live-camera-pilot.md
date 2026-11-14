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

En Stage, abrir **Invitados LIVE**, escribir el nombre y crear el enlace. Cada enlace dura 24 horas y sustituye el anterior de ese Deck y sesión. El invitado abre el enlace y ve una bienvenida con su nombre y el título vigente del Deck, con el logo IMMERSA. Pulsa **Entrar a la sala de espera** para autorizar cámara, micrófono y sonido. La vista muestra el slide arriba, la leyenda de sala de espera al centro y una previsualización grande de su cámara abajo. La cuenta regresiva ocupa la cámara; en LIVE aparece un marco rojo de 5 px y el sticker adjunto. El nombre y el título se escapan al renderizar el HTML. El slide sigue el índice transmitido a Pantalla y su idioma operativo, incluso en espera. Durante una pausa de transmisión conserva el slide público mientras producción navega en privado. No recibe controles, apuntador, enlaces de rol ni el manifiesto del Deck. Al reconectar recupera el slide vigente; al terminar se retiran la presentación y la cámara.

En Stage, seleccionar **Micrófono de producción** y pulsar **Activar / actualizar audio**. Usar audífonos para la conversación privada. La entrada se puede actualizar durante el enlace sin cambiar el enlace ni detener la cámara.

En Pantalla, activar el botón compartido de audio y abrir **Audio del evento**. Seleccionar una entrada de micrófono o consola y pulsar **Activar / actualizar entrada**. La entrada debe excluir la voz del invitado. La casilla **Incluir audios y videos de IMMERSA** agrega los medios HTML locales mediante captura de sus pistas de audio, sin incluir el video remoto del invitado. Desmarcarla si la consola ya entrega esa mezcla. La captura interna requiere soporte de `captureStream` del navegador de Pantalla, por ejemplo Chrome de escritorio. YouTube y medios protegidos requieren retorno externo de consola. El micrófono o entrada se puede corregir durante el enlace; si falla el cambio, se conserva la anterior.

Con el invitado conectado, pulsar **Preparar conexión**. Stage recibe el monitor y conversa en privado. **Enviar a Pantalla** espera video decodificado en Pantalla y audio de retorno recibido en Stage. Entonces el servidor publica **3, 2, 1**, un segundo por número, y habilita **LIVE**. Durante la cuenta la salida a público permanece oculta y silenciada. Al entrar en vivo, el retorno cambia automáticamente del micrófono privado de Stage al audio procedente de Pantalla. Stage conserva el monitor, con su reproducción de audio silenciada. El audio de retorno viaja de Pantalla a Stage y de ahí al invitado; Stage debe permanecer abierto.

**Volver a espera** retira inmediatamente la salida pública y recupera la conversación privada sin terminar la invitación ni la cámara. Cancela también una cuenta regresiva en curso. Una entrada posterior repite la cuenta. **Terminar enlace** finaliza la invitación y detiene la cámara; también libera la entrada de audio de Pantalla. Si se reproduce un video de IMMERSA durante LIVE, se oculta temporalmente la cámara pública y se conserva la conversación y el retorno; al terminar reaparece la cámara.

El invitado envía una señal de audio y video a Stage. Stage la reenvía a Pantalla por una segunda conexión WebRTC con retorno de audio. Stage debe permanecer abierto durante la intervención. Invitados LIVE es un panel lateral no modal y plegable. Se pliega automáticamente al entrar LIVE y conserva el mismo video y las conexiones. La barra compacta permanece bajo la cabecera con el estado y acciones de volver a espera, silenciar y terminar enlace, mientras se operan slides, interacciones y Audiovisual. Plegar o abrir el panel no corta el enlace. Una reserva compartida evita la simultaneidad con LIVE del Speaker. La pérdida de un participante corta la salida y exige preparar y dar entrada de nuevo. La autorización se revalida periódicamente y Pantalla mantiene un temporizador local para retirar video y audio si dejan de llegar renovaciones o fotogramas.

El estado al aire es efímero. Los enlaces se guardan mediante escritura atómica en `data/live-guests/`. Al finalizar la presentación, el enlace conectado se marca terminado. Para repetir una intervención finalizada se crea un enlace nuevo. Para desactivar el piloto, fijar `IMMERSA_LIVE_GUESTS_ENABLED=false` y desplegar.

La validación cubre un invitado, producción, Pantalla y el slide vigente para el invitado. Las reacciones y las preguntas seleccionadas para el invitado corresponden a los siguientes hitos.
