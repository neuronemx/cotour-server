(() => {
  "use strict";
  const VIDEOS = {
    horizontal: "https://media.immersalive.com/spots/Spot_2_H.mp4",
    vertical: "https://media.immersalive.com/spots/Spot_2_V.mp4"
  };

  window.ImmersaHomeHelp = {
    mount(button, startTour) {
      const menu = document.createElement("section");
      menu.id = "homeHelpMenu";
      menu.className = "home-help-menu";
      menu.hidden = true;
      menu.setAttribute("aria-label", "Ayuda de IMMERSA");
      menu.innerHTML = '<strong>¿Cómo te ayudamos?</strong><button type="button" data-help-tour>Recorrido guiado</button><button type="button" data-help-video aria-label="Ver video: primeros pasos"><span>Ver primeros pasos<small>Tu primer Deck · 48 s</small></span><img class="home-help-video-icon" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABLCAMAAACxxtKFAAAABGdBTUEAALGPC/xhBQAACjVpQ0NQc1JHQiBJRUM2MTk2Ni0yLjEAAEjHnZZ3VFTXFofPvXd6oc0wAlKG3rvAANJ7k15FYZgZYCgDDjM0sSGiAhFFRJoiSFDEgNFQJFZEsRAUVLAHJAgoMRhFVCxvRtaLrqy89/Ly++Osb+2z97n77L3PWhcAkqcvl5cGSwGQyhPwgzyc6RGRUXTsAIABHmCAKQBMVka6X7B7CBDJy82FniFyAl8EAfB6WLwCcNPQM4BOB/+fpFnpfIHomAARm7M5GSwRF4g4JUuQLrbPipgalyxmGCVmvihBEcuJOWGRDT77LLKjmNmpPLaIxTmns1PZYu4V8bZMIUfEiK+ICzO5nCwR3xKxRoowlSviN+LYVA4zAwAUSWwXcFiJIjYRMYkfEuQi4uUA4EgJX3HcVyzgZAvEl3JJS8/hcxMSBXQdli7d1NqaQffkZKVwBALDACYrmcln013SUtOZvBwAFu/8WTLi2tJFRbY0tba0NDQzMv2qUP91829K3NtFehn4uWcQrf+L7a/80hoAYMyJarPziy2uCoDOLQDI3fti0zgAgKSobx3Xv7oPTTwviQJBuo2xcVZWlhGXwzISF/QP/U+Hv6GvvmckPu6P8tBdOfFMYYqALq4bKy0lTcinZ6QzWRy64Z+H+B8H/nUeBkGceA6fwxNFhImmjMtLELWbx+YKuGk8Opf3n5r4D8P+pMW5FonS+BFQY4yA1HUqQH7tBygKESDR+8Vd/6NvvvgwIH554SqTi3P/7zf9Z8Gl4iWDm/A5ziUohM4S8jMX98TPEqABAUgCKpAHykAd6ABDYAasgC1wBG7AG/iDEBAJVgMWSASpgA+yQB7YBApBMdgJ9oBqUAcaQTNoBcdBJzgFzoNL4Bq4AW6D+2AUTIBnYBa8BgsQBGEhMkSB5CEVSBPSh8wgBmQPuUG+UBAUCcVCCRAPEkJ50GaoGCqDqqF6qBn6HjoJnYeuQIPQXWgMmoZ+h97BCEyCqbASrAUbwwzYCfaBQ+BVcAK8Bs6FC+AdcCXcAB+FO+Dz8DX4NjwKP4PnEIAQERqiihgiDMQF8UeikHiEj6xHipAKpAFpRbqRPuQmMorMIG9RGBQFRUcZomxRnqhQFAu1BrUeVYKqRh1GdaB6UTdRY6hZ1Ec0Ga2I1kfboL3QEegEdBa6EF2BbkK3oy+ib6Mn0K8xGAwNo42xwnhiIjFJmLWYEsw+TBvmHGYQM46Zw2Kx8lh9rB3WH8vECrCF2CrsUexZ7BB2AvsGR8Sp4Mxw7rgoHA+Xj6vAHcGdwQ3hJnELeCm8Jt4G749n43PwpfhGfDf+On4Cv0CQJmgT7AghhCTCJkIloZVwkfCA8JJIJKoRrYmBRC5xI7GSeIx4mThGfEuSIemRXEjRJCFpB+kQ6RzpLuklmUzWIjuSo8gC8g5yM/kC+RH5jQRFwkjCS4ItsUGiRqJDYkjiuSReUlPSSXK1ZK5kheQJyeuSM1J4KS0pFymm1HqpGqmTUiNSc9IUaVNpf+lU6RLpI9JXpKdksDJaMm4ybJkCmYMyF2TGKQhFneJCYVE2UxopFykTVAxVm+pFTaIWU7+jDlBnZWVkl8mGyWbL1sielh2lITQtmhcthVZKO04bpr1borTEaQlnyfYlrUuGlszLLZVzlOPIFcm1yd2WeydPl3eTT5bfJd8p/1ABpaCnEKiQpbBf4aLCzFLqUtulrKVFS48vvacIK+opBimuVTyo2K84p6Ss5KGUrlSldEFpRpmm7KicpFyufEZ5WoWiYq/CVSlXOavylC5Ld6Kn0CvpvfRZVUVVT1Whar3qgOqCmrZaqFq+WpvaQ3WCOkM9Xr1cvUd9VkNFw08jT6NF454mXpOhmai5V7NPc15LWytca6tWp9aUtpy2l3audov2Ax2yjoPOGp0GnVu6GF2GbrLuPt0berCehV6iXo3edX1Y31Kfq79Pf9AAbWBtwDNoMBgxJBk6GWYathiOGdGMfI3yjTqNnhtrGEcZ7zLuM/5oYmGSYtJoct9UxtTbNN+02/R3Mz0zllmN2S1zsrm7+QbzLvMXy/SXcZbtX3bHgmLhZ7HVosfig6WVJd+y1XLaSsMq1qrWaoRBZQQwShiXrdHWztYbrE9Zv7WxtBHYHLf5zdbQNtn2iO3Ucu3lnOWNy8ft1OyYdvV2o/Z0+1j7A/ajDqoOTIcGh8eO6o5sxybHSSddpySno07PnU2c+c7tzvMuNi7rXM65Iq4erkWuA24ybqFu1W6P3NXcE9xb3Gc9LDzWepzzRHv6eO7yHPFS8mJ5NXvNelt5r/Pu9SH5BPtU+zz21fPl+3b7wX7efrv9HqzQXMFb0ekP/L38d/s/DNAOWBPwYyAmMCCwJvBJkGlQXlBfMCU4JvhI8OsQ55DSkPuhOqHC0J4wybDosOaw+XDX8LLw0QjjiHUR1yIVIrmRXVHYqLCopqi5lW4r96yciLaILoweXqW9KnvVldUKq1NWn46RjGHGnIhFx4bHHol9z/RnNjDn4rziauNmWS6svaxnbEd2OXuaY8cp40zG28WXxU8l2CXsTphOdEisSJzhunCruS+SPJPqkuaT/ZMPJX9KCU9pS8Wlxqae5Mnwknm9acpp2WmD6frphemja2zW7Fkzy/fhN2VAGasyugRU0c9Uv1BHuEU4lmmfWZP5Jiss60S2dDYvuz9HL2d7zmSue+63a1FrWWt78lTzNuWNrXNaV78eWh+3vmeD+oaCDRMbPTYe3kTYlLzpp3yT/LL8V5vDN3cXKBVsLBjf4rGlpVCikF84stV2a9021DbutoHt5turtn8sYhddLTYprih+X8IqufqN6TeV33zaEb9joNSydP9OzE7ezuFdDrsOl0mX5ZaN7/bb3VFOLy8qf7UnZs+VimUVdXsJe4V7Ryt9K7uqNKp2Vr2vTqy+XeNc01arWLu9dn4fe9/Qfsf9rXVKdcV17w5wD9yp96jvaNBqqDiIOZh58EljWGPft4xvm5sUmoqbPhziHRo9HHS4t9mqufmI4pHSFrhF2DJ9NProje9cv+tqNWytb6O1FR8Dx4THnn4f+/3wcZ/jPScYJ1p/0Pyhtp3SXtQBdeR0zHYmdo52RXYNnvQ+2dNt293+o9GPh06pnqo5LXu69AzhTMGZT2dzz86dSz83cz7h/HhPTM/9CxEXbvUG9g5c9Ll4+ZL7pQt9Tn1nL9tdPnXF5srJq4yrndcsr3X0W/S3/2TxU/uA5UDHdavrXTesb3QPLh88M+QwdP6m681Lt7xuXbu94vbgcOjwnZHokdE77DtTd1PuvriXeW/h/sYH6AdFD6UeVjxSfNTws+7PbaOWo6fHXMf6Hwc/vj/OGn/2S8Yv7ycKnpCfVEyqTDZPmU2dmnafvvF05dOJZ+nPFmYKf5X+tfa5zvMffnP8rX82YnbiBf/Fp99LXsq/PPRq2aueuYC5R69TXy/MF72Rf3P4LeNt37vwd5MLWe+x7ys/6H7o/ujz8cGn1E+f/gUDmPP8YppLQgAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAACVBMVEUAAAD///////9zeKVjAAAAA3RSTlP//wDXyg1BAAAACXBIWXMAAAsTAAALEwEAmpwYAAAF8mlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgOS4wLWMwMDAgNzkuMTcxYzI3ZiwgMjAyMi8wOC8xNi0xODowMjo0MyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iIHhtbG5zOnBob3Rvc2hvcD0iaHR0cDovL25zLmFkb2JlLmNvbS9waG90b3Nob3AvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDI0LjAgKFdpbmRvd3MpIiB4bXA6Q3JlYXRlRGF0ZT0iMjAyNi0xMS0yMlQxOToxNDowNC0wNjowMCIgeG1wOk1vZGlmeURhdGU9IjIwMjYtMTEtMjJUMTk6MjI6MjItMDY6MDAiIHhtcDpNZXRhZGF0YURhdGU9IjIwMjYtMTEtMjJUMTk6MjI6MjItMDY6MDAiIGRjOmZvcm1hdD0iaW1hZ2UvcG5nIiBwaG90b3Nob3A6Q29sb3JNb2RlPSIyIiBwaG90b3Nob3A6SUNDUHJvZmlsZT0ic1JHQiBJRUM2MTk2Ni0yLjEiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6NDhjZmY2Y2QtNzEwMS0yYTQxLWFiNTItOWEwMDU5YTA3MzAyIiB4bXBNTTpEb2N1bWVudElEPSJhZG9iZTpkb2NpZDpwaG90b3Nob3A6OTVhN2EzNWUtMTYxYy1iZTRlLTg2MGQtYmZmODEwMWMwMzE0IiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6ZmJjNmVlNjktYTk2Yy1kMDRjLWFiZDItMGRmZTI5ODVjZTYyIj4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDpmYmM2ZWU2OS1hOTZjLWQwNGMtYWJkMi0wZGZlMjk4NWNlNjIiIHN0RXZ0OndoZW49IjIwMjYtMTEtMjJUMTk6MTQ6MDQtMDY6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyNC4wIChXaW5kb3dzKSIvPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6NDhjZmY2Y2QtNzEwMS0yYTQxLWFiNTItOWEwMDU5YTA3MzAyIiBzdEV2dDp3aGVuPSIyMDI2LTExLTIyVDE5OjIyOjIyLTA2OjAwIiBzdEV2dDpzb2Z0d2FyZUFnZW50PSJBZG9iZSBQaG90b3Nob3AgMjQuMCAoV2luZG93cykiIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4gPC9yZGY6U2VxPiA8L3htcE1NOkhpc3Rvcnk+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+HM9dZgAAAOtJREFUWMPt2esOgyAMBeDC+z/0Nk3MBmqrPT0RVv55/SKRUqjUpZWYtr68SiCxORJsLIpEGx9Fwo23wkHaP6E9vtDaJzukv/c20p+RnTf6kMpGaiKJjI38jhPKiP+6hItd2wnRps4bSNf+DDGSLsT6ZR7E3IMYRGFQyCmDQwoFOWagyJGDRnYZHdHDnMqoAfIkYpsDjye50xc5gOTOtJjyTr/FqoyOlOyuR/1duOQONuI5sYsThZ82n0wyx8+Rd42eC3Oy+lxpXUnucKvf3LnLXaJEcucOvXMXWnWYp0jDqWlxqnOcOmN4xfQFmdkrJ5XbHMoAAAAASUVORK5CYII=" width="50" height="38" alt="" aria-hidden="true"></button>';
      document.body.appendChild(menu);
      button.title = "Ayuda";
      button.setAttribute("aria-label", "Ayuda de IMMERSA");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", menu.id);

      const dialog = document.createElement("dialog");
      dialog.className = "home-help-video-dialog";
      dialog.setAttribute("aria-labelledby", "homeHelpVideoTitle");
      dialog.innerHTML = '<header><h2 id="homeHelpVideoTitle">Tu primer Deck</h2><button type="button" data-help-close aria-label="Cerrar video"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><video controls playsinline preload="none" aria-label="Video: primeros pasos en IMMERSA"></video><p data-help-error role="status" hidden>No se pudo cargar el video. Puedes volver a intentarlo o <a target="_blank" rel="noopener noreferrer">abrirlo en otra pestaña</a>.</p>';
      document.body.appendChild(dialog);
      const video = dialog.querySelector("video");
      const error = dialog.querySelector("[data-help-error]");
      const tourButton = menu.querySelector("[data-help-tour]");
      const videoButton = menu.querySelector("[data-help-video]");
      const closeButton = dialog.querySelector("[data-help-close]");

      function closeMenu(restoreFocus = false) {
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
        if (restoreFocus) button.focus();
      }
      button.addEventListener("click", () => {
        if (!menu.hidden) return closeMenu(true);
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        tourButton.focus();
      });
      tourButton.addEventListener("click", () => {
        closeMenu();
        startTour();
      });
      videoButton.addEventListener("click", () => {
        closeMenu();
        const portrait = window.matchMedia("(max-width: 700px) and (orientation: portrait)").matches;
        dialog.classList.toggle("is-portrait", portrait);
        error.hidden = true;
        const source = portrait ? VIDEOS.vertical : VIDEOS.horizontal;
        error.querySelector("a").href = source;
        // Choose once per opening: rotation must not restart an in-progress video.
        video.src = source;
        dialog.showModal();
        closeButton.focus();
      });
      closeButton.addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
      });
      // Keep Escape inside this layer; existing Deck/editor Escape handlers must not run.
      dialog.addEventListener("keydown", (event) => event.stopPropagation());
      dialog.addEventListener("close", () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
        button.focus();
      });
      video.addEventListener("error", () => { if (dialog.open) error.hidden = false; });
      document.addEventListener("click", (event) => {
        if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) closeMenu();
      });
      menu.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeMenu(true);
        }
      });
    }
  };
})();
