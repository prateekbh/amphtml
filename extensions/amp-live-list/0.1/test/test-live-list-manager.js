/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {LiveListManager, liveListManagerForDoc} from '../live-list-manager';
import {Services} from '../../../../src/services';

const XHR_BUFFER_SIZE = 2;

describes.fakeWin('LiveListManager', {amp: true}, env => {
  const jitterOffset = 1000;
  let win, doc;
  let ampdoc;
  let manager;
  let liveList;
  let xhrs;
  let clock;
  let viewer;
  let ready;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    win = env.win;
    doc = win.document;
    ampdoc = env.ampdoc;
    const docReadyPromise = new Promise(resolve => { ready = resolve; });
    sandbox.stub(LiveListManager.prototype, 'whenDocReady_')
        .returns(docReadyPromise);
    clock = sandbox.useFakeTimers();
    xhrs = setUpMockXhrs(sandbox);
    viewer = Services.viewerForDoc(ampdoc);
    manager = liveListManagerForDoc(ampdoc);
    liveList = getLiveList({'data-sort-time': '1111'});
    sandbox.stub(liveList, 'getInterval').callsFake(() => 5000);
  });

  function setUpMockXhrs(sandbox) {
    const mockXhr = sandbox.useFakeXMLHttpRequest();
    const xhrs = [];
    const xhrResolvers = [];
    for (let i = 0; i < XHR_BUFFER_SIZE; i++) {
      xhrs[i] = new Promise(resolve => xhrResolvers[i] = resolve);
    }
    let xhrCount = 0;
    mockXhr.onCreate = function(xhr) {
      xhrResolvers[xhrCount++](xhr);
    };
    return xhrs;
  }

  afterEach(() => {
    sandbox.restore();
  });

  /** @implements {!LiveListInterface} */
  class AmpLiveListMock {

    constructor(el) {
      this.element = el;
    }

    buildCallback() {
      this.manager_ = liveListManagerForDoc(ampdoc);
      this.updateTime_ = Number(this.element.getAttribute('data-sort-time'));
      this.manager_.register(this.element.getAttribute('id'), this);
    }

    getInterval() {
      return Number(this.element.getAttribute('data-poll-interval'));
    }

    update() {}

    isEnabled() {
      return !this.element.hasAttribute('disabled');
    }

    toggle(value) {
      if (value) {
        this.element.removeAttribute('disabled');
      } else {
        this.element.setAttribute('disabled', '');
      }
    }

    getUpdateTime() {
      return this.updateTime_;
    }
  }

  function getLiveList(attrs = {}, opt_id) {
    const el = doc.createElement('amp-live-list');
    el.setAttribute('id', opt_id || 'id-1');
    el.setAttribute('data-max-items-per-page', '10');
    const updateSlot = doc.createElement('div');
    const itemsSlot = doc.createElement('div');
    updateSlot.setAttribute('update', '');
    itemsSlot.setAttribute('items', '');
    el.appendChild(updateSlot);
    el.appendChild(itemsSlot);
    for (const key in attrs) {
      el.setAttribute(key, attrs[key]);
    }

    if (!('data-poll-interval' in attrs)) {
      el.setAttribute('data-poll-interval', 8000);
    }
    return new AmpLiveListMock(el);
  }

  it('should register new amp-live-list', () => {
    ready();
    liveList.buildCallback();
    expect(manager.liveLists_['id-1']).to.equal(liveList);
  });

  it('should back off on transient 415 response', () => {
    sandbox.stub(Math, 'random').callsFake(() => 1);
    ready();
    const fetchSpy = sandbox.spy(manager, 'work_');
    liveList.buildCallback();
    return manager.whenDocReady_().then(() => {
      const interval = liveList.getInterval();
      const tick = interval - jitterOffset;
      expect(manager.poller_.isRunning()).to.be.true;
      expect(fetchSpy).to.have.not.been.called;
      clock.tick(tick);
      expect(fetchSpy).to.be.calledOnce;
      xhrs[0].then(
          xhr => xhr.respond(
              200, {
                'Content-Type': 'text/xml',
              },
              '<html></html>'));

      return manager.poller_.lastWorkPromise_.then(() => {
        expect(manager.poller_.isRunning()).to.be.true;
        clock.tick(tick);
        xhrs[1].then(
            xhr => xhr.respond(
                415, {
                  'Content-Type': 'text/xml',
                },
                '<html></html>'));
        expect(fetchSpy).to.have.callCount(2);
        expect(manager.poller_.backoffClock_).to.be.null;
        return manager.poller_.lastWorkPromise_.then(() => {
          expect(manager.poller_.isRunning()).to.be.true;
          expect(manager.poller_.backoffClock_).to.be.a('function');
        });
      });
    });
  });

  it('should back off on transient 500 response', () => {
    sandbox.stub(Math, 'random').callsFake(() => 1);
    ready();
    const fetchSpy = sandbox.spy(manager, 'work_');
    liveList.buildCallback();
    return manager.whenDocReady_().then(() => {
      const interval = liveList.getInterval();
      const tick = interval - jitterOffset;
      expect(manager.poller_.isRunning()).to.be.true;
      expect(fetchSpy).to.have.not.been.called;
      clock.tick(tick);
      expect(fetchSpy).to.be.calledOnce;
      xhrs[0].then(
          xhr => xhr.respond(
              200, {
                'Content-Type': 'text/xml',
              },
              '<html></html>'));

      return manager.poller_.lastWorkPromise_.then(() => {
        expect(manager.poller_.isRunning()).to.be.true;
        clock.tick(tick);
        xhrs[1].then(
            xhr => xhr.respond(
                500, {
                  'Content-Type': 'text/xml',
                },
                '<html></html>'));
        expect(fetchSpy).to.have.callCount(2);
        expect(manager.poller_.backoffClock_).to.be.null;
        return manager.poller_.lastWorkPromise_.then(() => {
          expect(manager.poller_.isRunning()).to.be.true;
          expect(manager.poller_.backoffClock_).to.be.a('function');
        });
      });
    });
  });

  it('should recover after transient 415 response', () => {
    sandbox.stub(Math, 'random').callsFake(() => 1);
    sandbox.stub(viewer, 'isVisible').returns(true);
    ready();
    const fetchSpy = sandbox.spy(manager, 'work_');
    liveList.buildCallback();
    return manager.whenDocReady_().then(() => {
      const interval = liveList.getInterval();
      const tick = interval - jitterOffset;
      expect(manager.poller_.isRunning()).to.be.true;
      expect(fetchSpy).to.have.not.been.called;
      clock.tick(tick);
      expect(fetchSpy).to.be.calledOnce;
      expect(manager.poller_.backoffClock_).to.be.null;
      xhrs[0].then(
          xhr => xhr.respond(
              415, {
                'Content-Type': 'text/xml',
              },
              '<html></html>'));
      return manager.poller_.lastWorkPromise_.then(() => {
        expect(manager.poller_.isRunning()).to.be.true;
        expect(manager.poller_.backoffClock_).to.be.a('function');
        // tick 1 max initial backoff with random = 1
        clock.tick(700);
        expect(fetchSpy).to.have.callCount(2);
        xhrs[1].then(
            xhr => xhr.respond(
                200, {
                  'Content-Type': 'text/xml',
                },
                '<html></html>'));
        return manager.poller_.lastWorkPromise_.then(() => {
          expect(manager.poller_.isRunning()).to.be.true;
          expect(manager.poller_.backoffClock_).to.be.null;
        });
      });
    });
  });
});

describes.realWin('install scripts', {
  amp: true,
  fakeRegisterElement: true,
}, env => {
  let manager;
  let ampdoc;
  let win;
  let doc;
  let extensions;

  beforeEach(function() {
    win = env.win;
    doc = win.document;
    ampdoc = env.ampdoc;
    extensions = env.extensions;
    manager = liveListManagerForDoc(ampdoc);
  });

  it('should install newly discovered script tags on xhr doc', () => {
    // Emulate doc
    const div = document.createElement('div');
    const script1 = document.createElement('script');
    const script2 = document.createElement('script');
    script1.setAttribute('custom-element', 'amp-test');
    script2.setAttribute('custom-template', 'amp-template');
    div.appendChild(script1);
    div.appendChild(script2);

    expect(doc.head.querySelectorAll(
        '[custom-element="amp-test"]')).to.have.length(0);
    expect(extensions.extensions_['amp-test']).to.be.undefined;

    expect(doc.head.querySelectorAll(
        '[custom-template="amp-template"]')).to.have.length(0);
    expect(extensions.extensions_['amp-template']).to.be.undefined;

    manager.installExtensionsForDoc_(div);

    expect(doc.head.querySelectorAll(
        '[custom-element="amp-test"]')).to.have.length(1);
    expect(extensions.extensions_['amp-test'].scriptPresent).to.be.true;

    expect(doc.head.querySelectorAll(
        '[custom-element="amp-template"]')).to.have.length(1);
    expect(extensions.extensions_['amp-template'].scriptPresent).to.be.true;
  });
});
