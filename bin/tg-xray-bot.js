#!/usr/bin/env node
'use strict';

const path = require('path');
const distIndex = path.join(__dirname, '..', 'dist', 'index.js');

require(distIndex);
