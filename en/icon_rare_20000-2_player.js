(function () {
  "use strict";

  var TARGET_TEXTURE_ID = 0;
  var LWF_WIDTH = 852;
  var LWF_HEIGHT = 1536;
  var AUTO_SWITCH_MS = 3400;
  var TARGET_FILL_X = 0.58;
  var TARGET_FILL_Y = 0.46;

  var canvas = document.getElementById("stage");
  var statusEl = document.getElementById("status");
  var effectNameEl = document.getElementById("effectName");
  var effectListEl = document.getElementById("effectList");
  var prevButton = document.getElementById("prevButton");
  var nextButton = document.getElementById("nextButton");
  var playButton = document.getElementById("playButton");

  var data = null;
  var lwf = null;
  var activeMovie = null;
  var effects = [];
  var activeIndex = 0;
  var playing = true;
  var lastTime = 0;
  var lastSwitchTime = 0;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error("Could not load " + url));
      };
      image.src = url;
    });
  }

  function makeTransparentTexture(width, height) {
    var texture = document.createElement("canvas");
    texture.width = width;
    texture.height = height;
    return texture;
  }

  function bitmapUsesTexture(bitmapId, textureId) {
    var bitmap = data.bitmaps[bitmapId];
    var fragment = bitmap && data.textureFragments[bitmap.textureFragmentId];
    return Boolean(fragment && fragment.textureId === textureId);
  }

  function bitmapExUsesTexture(bitmapExId, textureId) {
    var bitmapEx = data.bitmapExs[bitmapExId];
    var fragment = bitmapEx && data.textureFragments[bitmapEx.textureFragmentId];
    return Boolean(fragment && fragment.textureId === textureId);
  }

  function graphicUsesTexture(graphicId, textureId, seenMovies) {
    var graphic = data.graphics[graphicId];
    var i;
    var graphicObject;

    if (!graphic) {
      return false;
    }

    for (i = 0; i < graphic.graphicObjects; i += 1) {
      graphicObject = data.graphicObjects[graphic.graphicObjectId + i];
      if (!graphicObject) {
        continue;
      }
      if (graphicObject.graphicObjectType === 0 &&
          bitmapUsesTexture(graphicObject.graphicObjectId, textureId)) {
        return true;
      }
      if (graphicObject.graphicObjectType === 1 &&
          bitmapExUsesTexture(graphicObject.graphicObjectId, textureId)) {
        return true;
      }
    }

    return false;
  }

  function objectUsesTexture(objectId, textureId, seenMovies) {
    var objectData = data.objects[objectId];

    if (!objectData) {
      return false;
    }

    switch (objectData.objectType) {
      case 1:
        return graphicUsesTexture(objectData.objectId, textureId, seenMovies);
      case 2:
        return movieUsesTexture(objectData.objectId, textureId, seenMovies);
      case 3:
        return bitmapUsesTexture(objectData.objectId, textureId);
      case 4:
        return bitmapExUsesTexture(objectData.objectId, textureId);
      default:
        return false;
    }
  }

  function movieUsesTexture(movieId, textureId, seenMovies) {
    var movie;
    var frameIndex;
    var frame;
    var controlIndex;
    var control;
    var place;

    if (seenMovies.has(movieId)) {
      return false;
    }
    seenMovies.add(movieId);

    movie = data.movies[movieId];
    if (!movie) {
      return false;
    }

    for (frameIndex = 0; frameIndex < movie.frames; frameIndex += 1) {
      frame = data.frames[movie.frameOffset + frameIndex];
      for (controlIndex = 0; controlIndex < frame.controls; controlIndex += 1) {
        control = data.controls[frame.controlOffset + controlIndex];
        if (control.controlType !== 0) {
          continue;
        }
        place = data.places[control.controlId];
        if (place && objectUsesTexture(place.objectId, textureId, seenMovies)) {
          return true;
        }
      }
    }

    return false;
  }

  function buildEffectList() {
    effects = data.movieLinkages
      .map(function (linkage) {
        return {
          name: data.strings[linkage.stringId],
          movieId: linkage.movieId
        };
      })
      .filter(function (effect) {
        return /^ef_\d+$/.test(effect.name) &&
          movieUsesTexture(effect.movieId, TARGET_TEXTURE_ID, new Set());
      })
      .sort(function (a, b) {
        return parseInt(a.name.slice(3), 10) - parseInt(b.name.slice(3), 10);
      });
  }

  function renderEffectButtons() {
    effectListEl.innerHTML = "";
    effects.forEach(function (effect, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = effect.name;
      button.title = effect.name;
      button.addEventListener("click", function () {
        selectEffect(index, true);
      });
      effectListEl.appendChild(button);
    });
  }

  function updateActiveButton() {
    Array.prototype.forEach.call(effectListEl.children, function (button, index) {
      button.classList.toggle("isActive", index === activeIndex);
    });
  }

  function centerMovie(movie) {
    var bounds = movie.getBounds();
    var boundsWidth;
    var boundsHeight;
    var scale;
    var centerX;
    var centerY;

    if (!bounds ||
        !isFinite(bounds.xMin) || !isFinite(bounds.xMax) ||
        !isFinite(bounds.yMin) || !isFinite(bounds.yMax)) {
      movie.moveTo(LWF_WIDTH / 2, LWF_HEIGHT / 2);
      return;
    }

    boundsWidth = Math.max(1, bounds.xMax - bounds.xMin);
    boundsHeight = Math.max(1, bounds.yMax - bounds.yMin);
    scale = Math.min(
      (LWF_WIDTH * TARGET_FILL_X) / boundsWidth,
      (LWF_HEIGHT * TARGET_FILL_Y) / boundsHeight
    );
    scale = Math.max(0.55, Math.min(2.4, scale));
    centerX = (bounds.xMin + bounds.xMax) * 0.5 * scale;
    centerY = (bounds.yMin + bounds.yMax) * 0.5 * scale;

    movie.scaleTo(scale, scale);
    movie.moveTo((LWF_WIDTH / 2) - centerX, (LWF_HEIGHT / 2) - centerY);
  }

  function selectEffect(index, manual) {
    var effect;

    if (!lwf || effects.length === 0) {
      return;
    }

    activeIndex = (index + effects.length) % effects.length;
    effect = effects[activeIndex];
    effectNameEl.textContent = effect.name;
    updateActiveButton();

    activeMovie = lwf.rootMovie.attachMovie(effect.name, "active", { depth: 1 });
    if (activeMovie) {
      activeMovie.gotoAndPlay(1);
      activeMovie.moveTo(0, 0);
      activeMovie.scaleTo(1, 1);
      activeMovie.requestCalculateBounds(function () {
        centerMovie(this);
      });
    }

    if (manual) {
      lastSwitchTime = performance.now();
    }
  }

  function step(now) {
    var tick;

    if (!lastTime) {
      lastTime = now;
    }
    tick = Math.min(0.08, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    if (lwf && playing) {
      if (now - lastSwitchTime > AUTO_SWITCH_MS) {
        selectEffect(activeIndex + 1, false);
        lastSwitchTime = now;
      }
      lwf.exec(tick);
      lwf.render();
    }

    requestAnimationFrame(step);
  }

  function wireControls() {
    prevButton.addEventListener("click", function () {
      selectEffect(activeIndex - 1, true);
    });

    nextButton.addEventListener("click", function () {
      selectEffect(activeIndex + 1, true);
    });

    playButton.addEventListener("click", function () {
      playing = !playing;
      playButton.textContent = playing ? "Pause" : "Play";
      playButton.title = playing ? "Pause animation" : "Play animation";
      lastTime = performance.now();
    });
  }

  async function boot() {
    var response;
    var arrayBuffer;
    var imageCache = {};
    var targetTexture;
    var textureIndex;
    var texture;
    var factory;

    wireControls();

    if (!window.LWF) {
      throw new Error("LWF runtime is not loaded");
    }

    response = await fetch("icon_rare_20000.lwf");
    if (!response.ok) {
      throw new Error("Could not load icon_rare_20000.lwf");
    }

    arrayBuffer = await response.arrayBuffer();
    data = LWF.Loader.loadArrayBuffer(arrayBuffer);
    if (!data || !data.check()) {
      throw new Error("Invalid LWF data");
    }

    targetTexture = data.textures[TARGET_TEXTURE_ID];
    imageCache[targetTexture.filename] = await loadImage(targetTexture.filename);

    for (textureIndex = 0; textureIndex < data.textures.length; textureIndex += 1) {
      if (textureIndex === TARGET_TEXTURE_ID) {
        continue;
      }
      texture = data.textures[textureIndex];
      imageCache[texture.filename] = makeTransparentTexture(texture.width, texture.height);
    }

    buildEffectList();
    renderEffectButtons();

    LWF.useCanvasRenderer();
    factory = new LWF.CanvasRendererFactory(
      data,
      LWF.ResourceCache.get(),
      imageCache,
      canvas,
      false,
      true,
      false
    );
    lwf = new LWF.LWF(data, factory, null, null);
    window.iconRare20000LWF = lwf;

    if (effects.length === 0) {
      setStatus("No texture 0 effect");
      return;
    }

    setStatus("Texture 0 / " + effects.length + " effects");
    lastSwitchTime = performance.now();
    selectEffect(0, true);
    requestAnimationFrame(step);
  }

  boot().catch(function (error) {
    setStatus(error.message);
    throw error;
  });
}());
