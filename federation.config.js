// Native-federation config for the "mastodon" remote.
//
// The shareAll args + RxJS skip list live in ./federation-base.js (copied
// verbatim from the hugmesh.systems reference) so this remote's federation
// surface can't drift from the host and the other HugMesh remotes. The
// remote name ("mastodon") and the exposed module key ("./routes") are the
// contract the host's loadRemoteModule() depends on — keep them stable.
const { hugmeshRemote } = require('./federation-base');

module.exports = hugmeshRemote({
  name: 'mastodon',
  exposes: {
    './routes': './src/app/mastodon.routes.ts',
  },
});
