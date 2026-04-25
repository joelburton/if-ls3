.PHONY: compiler langserver ext ext-install test

compiler:
	$(MAKE) -C Inform6

langserver:
	cd langserver && npm run build

ext:
	cd langserver && npm run package-vsix

ext-install: ext
	cd langserver && npm run install-vsix

test:
	cd langserver && npm test
