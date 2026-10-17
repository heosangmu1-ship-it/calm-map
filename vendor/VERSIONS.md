# Vendored libraries
- tf.min.js: @tensorflow/tfjs 4.22.0 (published 2024-10-21), https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js, Apache-2.0, 1.47 MB.
- tf-backend-wasm.min.js, tfjs-backend-wasm-simd.wasm, tfjs-backend-wasm.wasm: @tensorflow/tfjs-backend-wasm 4.22.0 (same release as tf.min.js), https://registry.npmjs.org/@tensorflow/tfjs-backend-wasm/-/tfjs-backend-wasm-4.22.0.tgz (`dist/`), Apache-2.0, 150 KB + 425 KB (SIMD) + 311 KB (plain). The threaded build is not vendored: GitHub Pages cannot send COOP/COEP. Loaded only inside `js/model-worker.js`.
- ../model/yamnet: YAMNet TF.js graph model, https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1, Apache-2.0, model.json 100 KB + 4 shards (~16 MB).
- ../data/yamnet_class_map.json: display_name list from tensorflow/models research/audioset/yamnet/yamnet_class_map.csv (Apache-2.0).
- icons/sprite.svg: Lucide lucide-static 1.58.0 (npm), ISC, https://lucide.dev; 21 symbols (map-pin clock mic square play list lock info bell-ring megaphone cog audio-lines message-circle leaf ear zap speaker timer sun volume-2 x) merged into one `<symbol>` sprite, LICENSE beside it.
