var NativeWindow = require('./bindings').Window,
    App = require('./bindings').App,
    bridge = require('./bridge'),
    EventEmitter = process.EventEmitter,
    _hasOwn = Object.prototype.hasOwnProperty,
    _slice = Array.prototype.slice,
    _apply = Function.prototype.apply,
    _bind = Function.prototype.bind,
    screenHeight = App.prototype.screenHeight,
    screenWidth = App.prototype.screenWidth,
    frames = new WeakMap,
    handlers = new WeakMap;


function unwrap(o){
  return frames.get(o);
}

function neuter(o){
  var handler = handlers.get(o);
  if (handler) {
    handler.window = {};
    handler.target = {};
  }
}

module.exports = Window;


function Window(nativeWindow){
  if (!(this instanceof Window))
    return new Window(nativeWindow);

  var self = this;
  var handler = new WindowHandler(nativeWindow, this);
  var window = Proxy.create(handler, Window.prototype);
  var frame = this.frame = new Frame(nativeWindow);

  nativeWindow.on('ready', function(){
    nativeWindow.runInBrowser(bridge);
    bridge(nativeWindow, handler, window);
    setTimeout(function(){
      var windowProto = window.__proto__;
      windowProto._events = self._events;
      ['on', 'off', 'emit', 'once'].forEach(function(key){
        windowProto[key] = EventEmitter.prototype[key];
      });
      window.frame = frame;
      window.emit('ready');
    }, 100);
  });

  nativeWindow.on('context-released', function(){
    handler.__proto__ = WindowHandler.prototype;
  });

  return window;
}

Window.prototype = Object.create(EventEmitter.prototype, {
  constructor: {
    configurable: true,
    writable: true,
    value: Window
  },
  toString: {
    configurable: true,
    writable: true,
    value: function toString(){
      return '[object Window]';
    }
  }
});



function Reflector(target){
  this.target = target;
}

Reflector.prototype = {
  keys: function keys(){
    return Object.keys(this.target);
  },
  enumerate: function enumerate(){
    var i=0, k=[];
    for (k[i++] in this.target);
    return k;
  },
  getOwnPropertyNames: function getOwnPropertyNames(){
    return Object.getOwnPropertyNames(this.target);
  },
  get: function get(rcvr, key){
    return this.target[key];
  },
  set: function set(rcvr, key, value){
    this.target[key] = value;
    return true;
  },
  has: function has(key){
    return key in this.target;
  },
  hasOwn: function hasOwn(key){
    return _hasOwn.call(this.target, key);
  },
  delete: function delete_(key){
    delete this.target[key];
    return true;
  },
  defineProperty: function defineProperty(key, desc){
    Object.defineProperty(this.target, key, desc);
    return true;
  },
  getOwnPropertyDescriptor: function getOwnPropertyDescriptor(key){
    var desc = Object.getOwnPropertyDescriptor(this.target, key);
    desc && (desc.configurable = true);
    return desc;
  },
  apply: function apply(rcvr, args){
    return _apply.call(this.target, rcvr, args);
  },
  construct: function construct(args){
    return new (_bind.apply(this.target, [null].concat(args)));
  }
};



function WindowHandler(nativeWindow, target){
  this.window = nativeWindow;
  this.target = target;
}

WindowHandler.prototype = Object.create(Reflector.prototype);

function RefType(properties, accessors){
  this.refs = Object.create(null);
  if (Array.isArray(properties)) {
    this.names = properties;
    properties.forEach(function(key){
      this[key] = key;
    }, this.refs);
  } else {
    this.names = Object.keys(properties);
    this.names.forEach(function(key){
      this[key] = properties[key];
    }, this.refs);
  }

  this.accessors = Object.create(null);
  if (accessors) {
    var accessorNames = Object.keys(accessors);
    this.names = this.names.concat(accessorNames);
    accessorNames.forEach(function(key){
      this[key] = Object.getOwnPropertyDescriptor(accessors, key);
    }, this.accessors);
  }

  function RefHandler(ref, target){
    this.ref = ref;
    this.target = target;
  }

  RefHandler.prototype = this;

  return function Creator(ref){
    var handler = new RefHandler(ref, this);
    var proxy = Proxy.create(handler, Creator.prototype);
    handlers.set(proxy, handler);
    return proxy;
  };
}


RefType.prototype = {
  keys: function keys(){
    return this.names.concat(Object.keys(this.target));
  },
  enumerate: function enumerate(){
    var i = this.names.length, k = this.names.slice();
    for (k[i++] in this.target);
    return k;
  },
  getOwnPropertyNames: function getOwnPropertyNames(){
    return this.names.concat(Object.getOwnPropertyNames(this.target));
  },
  get: function get(rcvr, key){
    if (key === '__proto__') {
      return this.target.__proto__;
    } else if (key in this.refs) {
      return this.ref[this.refs[key]];
    } else if (key in this.accessors) {
      return this.accessors[key].get.call(this.ref);
    } else {
      return this.target[key];
    }
  },
  set: function set(rcvr, key, value){
    if (key in this.refs) {
      this.ref[this.refs[key]] = value;
    } else if (key in this.accessors) {
      this.accessors[key].set.call(this.ref, value);
    } else {
      this.target[key] = value;
    }
    return true;
  },
  has: function has(key){
    return key in this.refs || key in this.accessors || key in this.target;
  },
  hasOwn: function hasOwn(key){
    return key in this.refs || key in this.accessors || _hasOwn.call(this.target, key);
  },
  delete: function delete_(key){
    if (key in this.refs) {
      delete this.ref[this.refs[key]];
    } else {
      delete this.target[key];
    }
    return true;
  },
  defineProperty: function defineProperty(key, desc){
    if (key in this.refs) {
      Object.defineProperty(this.ref, this.refs[key], desc);
    } else if (key in this.accessors) {
      this.accessors[key].set.call(this.ref, desc.value);
    } else {
      Object.defineProperty(this.target, key, desc);
    }
    return true;
  },
  getOwnPropertyDescriptor: function getOwnPropertyDescriptor(key){
    if (key in this.refs) {
      var desc = Object.getOwnPropertyDescriptor(this.ref, this.refs[key]);
    } else if (key in this.accessors) {
      return {
        enumerable: true, configurable: true, writable: true,
        value: this.accessors[key].get.call(this.ref)
      };
    } else {
      var desc = Object.getOwnPropertyDescriptor(this.target, key);
    }
    desc && (desc.configurable = true);
    return desc;
  },
  apply: function apply(rcvr, args){
    return _apply.call(this.ref, rcvr, args);
  },
  construct: function construct(args){
    return new (_bind.apply(this.ref, [null].concat(args)));
  }
};

var props = ['left', 'top', 'width', 'height', 'title', 'state',
             'topmost', 'showChrome', 'resizable', 'opacity', 'alpha'];

var FrameImpl = new RefType(props, {
  get right(){
    return screenWidth() - this.left - this.width;
  },
  set right(v){
    if (this.resizable) {
      this.width = Math.max(0, screenWidth() - this.left - v);
    } else {
      this.left = screenWidth() - this.width - v;
    }
  },
  get bottom(){
    return screenHeight() - this.top - this.height;
  },
  set bottom(v){
    if (this.resizable) {
      this.height = Math.max(0, screenHeight() - this.top - v);
    } else {
      this.top = screenHeight() - this.height - v;
    }
  }
});

function Frame(win){
  if (!(win instanceof NativeWindow))
    throw new TypeError('Invalid Constructor Invocation');

  var frame = new FrameImpl(win);
  frames.set(frame, win);
  return frame;
}

Frame.prototype = FrameImpl.prototype = {
  constructor: Frame,
  center: function center(){
    unwrap(this).move((screenHeight() - this.height) / 2, (screenWidth() - this.width) / 2);
    return this;
  },
  drag: function drag(){
    unwrap(this).drag();
    return this;
  },
  minimize: function minimize(){
    unwrap(this).minimize();
    return this;
  },
  maximize: function maximize(){
    unwrap(this).maximize();
    return this;
  },
  restore: function restore(){
    unwrap(this).restore();
    return this;
  },
  fullscreen: function fullscreen(){
    unwrap(this).fullscreen();
    return this;
  },
  show: function show(){
    unwrap(this).show();
    return this;
  },
  hide: function hide(){
    unwrap(this).hide();
    return this;
  },
  move: function move(top, left, width, height){
    unwrap(this).move(top, left, width, height);
    return this;
  },
  resize: function resize(width, height){
    unwrap(this).resize(width, height)
    return this
  },
  openDevTools: function openDevTools(){
    unwrap(this).openDevTools();
  },
  closeDevTools: function closeDevTools(){
    unwrap(this).closeDevTools();
  },
  toString: function toString(){
    return '[object Frame]';
  }
};

Object.keys(Frame.prototype).forEach(function(key){
  Object.defineProperty(Frame.prototype, key, { enumerable: false });
});
