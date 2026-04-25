.PHONY: compiler langserver ext ext-install test clean

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

clean:
	rm -f  Inform6/inform6
	rm -rf langserver/out
	rm -rf langserver/bundled-server
	rm -rf langserver/textmate-dist
	rm -f  langserver/*.vsix
