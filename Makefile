test:
	./node_modules/.bin/jasmine-node --verbose --color ./test/spec/

lint:
	jshint --show-non-errors http-util.js test/spec/http-util.spec.js

.PHONY: test lint