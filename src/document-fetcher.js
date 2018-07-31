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
import {Services} from './services';
import {getViewerInterceptResponse, setupAMPCors, setupInit, setupInput, verifyAmpCORSHeaders} from './utils/xhr-utils';
import {parseUrlDeprecated} from './url';
import {user} from './log';

/**
 *
 *
 * @param {!Window} win
 * @param {string} input
 * @param {?FetchInitDef=} opt_init
 * @return {!Promise<!Document>}
 * @ignore
 */
export function fetchDocument(win, input, opt_init) {
  let init = setupInit(opt_init, 'text/html');
  init = setupAMPCors(win, input, init);
  input = setupInput(win, input, init);
  const ampdocService = Services.ampdocServiceFor(win);
  const ampdocSingle_ =
  ampdocService.isSingleDoc() ? ampdocService.getAmpDoc() : null;
  init.responseType = 'document';
  return getViewerInterceptResponse(win, ampdocSingle_, input, init)
      .then(interceptorResponse => {
        if (interceptorResponse) {
          return interceptorResponse.text().then(body =>
            new DOMParser().parseFromString(body, 'text/html')
          );
        }
        return xhrRequest_(input, init).then(({xhr, response}) => {
          verifyAmpCORSHeaders(win, response, init);
          return xhr.responseXML;
        }, reason => {
          const targetOrigin = parseUrlDeprecated(input).origin;
          throw user().createExpectedError('XHR', 'Failed fetching' +
              ` (${targetOrigin}/...):`, reason && reason.message);
        });
      });
}

/**
 *
 *
 * @param {string} input
 * @param {!FetchInitDef} init
 * @private
 */
function xhrRequest_(input, init) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method || 'GET', input, true);
    xhr.withCredentials = (init.credentials == 'include');
    xhr.responseType = 'document';
    // Incoming headers are in fetch format,
    // so we need to convert them into xhr.
    if (init.headers) {
      for (const header in init.headers) {
        xhr.setRequestHeader(header, init.headers[header]);
      }
    }
    xhr.onreadystatechange = () => {
      if (xhr.readyState < /* STATUS_RECEIVED */ 2) {
        return;
      }
      if (xhr.status < 100 || xhr.status > 599) {
        xhr.onreadystatechange = null;
        reject(user().createExpectedError(
            `Unknown HTTP status ${xhr.status}`));
        return;
      }
      // TODO(dvoytenko): This is currently simplified: we will wait for the
      // whole document loading to complete. This is fine for the use cases
      // we have now, but may need to be reimplemented later.
      if (xhr.readyState == /* COMPLETE */ 4) {
        const options = {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseHeaders(xhr.getAllResponseHeaders()),
        };
        const body = 'response' in xhr
          ? xhr.response : xhr.responseText;
        resolve({
          response: new Response(/** @type {string} */ (body || ''), /** @type {!ResponseInit} */ (options)),
          xhr,
        });
      }
    };
    xhr.onerror = () => {
      reject(user().createExpectedError('Request failure'));
    };
    xhr.onabort = () => {
      reject(user().createExpectedError('Request aborted'));
    };
    if (init.method == 'POST') {
      xhr.send(/** @type {!FormData} */ (init.body));
    } else {
      xhr.send();
    }
  });
}

/**
 *
 * @param {string} rawHeaders
 * @return {JsonObject}
 */
function parseHeaders(rawHeaders) {
  const headers = {};
  // Replace instances of \r\n and \n followed by at least one
  // space or horizontal tab with a space
  // https://tools.ietf.org/html/rfc7230#section-3.2
  const preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ');
  preProcessedHeaders.split(/\r?\n/).forEach(function(line) {
    const parts = line.split(':');
    const key = parts.shift().trim();
    if (key) {
      const value = parts.join(':').trim();
      headers[key] = value;
    }
  });
  return headers;
}
