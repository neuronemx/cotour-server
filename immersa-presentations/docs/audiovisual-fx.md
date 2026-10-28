# Transiciones FX locales

En la carpeta que vinculas desde Pantalla, crea una subcarpeta `FX`. Cada transición contiene un WebM y un TXT del mismo nombre:

```text
Mi librería/
  FX/
    Cortina.webm
    Cortina.txt
    Destello.webm
    Destello.txt
```

Contenido de `Cortina.txt`:

```text
03:15
FPS=30
```

La primera línea significa **segundos:cuadros**, no minutos:segundos. A 30 fps, `03:15` son 3.5 segundos. A 60 fps son 3.25 segundos. Cada TXT debe indicar los FPS de su WebM. Se admiten valores decimales y racionales, como `FPS=29.97` o `FPS=30000/1001`. El conteo de cuadros empieza en cero.

Después de vincular o actualizar la carpeta en Pantalla, abre Audiovisual → FX en Speaker. Cada transición aparece por separado con su marca. Selecciónala para reproducirla: cuando Pantalla llegue a la marca, la presentación avanza una sola slide y el WebM continúa hasta terminar. No hay loop ni reproducción consecutiva de la carpeta FX. Puedes volver a lanzar la misma transición después de terminarla o detenerla.

La marca debe estar antes del final del video. Un TXT ausente o inválido deja ese FX fuera de la lista; Pantalla indica cuántos necesitan corrección y muestra el detalle al pasar el cursor sobre el estado de la librería. Corrige los archivos y actualiza la carpeta.

Detener o sustituir el FX antes de la marca cancela su avance. Si navegas manualmente durante el FX, o pausas la transmisión, el FX no añade un salto pendiente. En la última slide no se sale del deck. Varias Pantallas no producen avances duplicados.

Los archivos siguen en la computadora de Pantalla. Público recibe el cambio de slide sincronizado, como en la navegación habitual.
