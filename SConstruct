# default header
import os
env = Environment(CXX="clang++", CCFLAGS='-std=c++11 -O3')
env['ENV']['TERM'] = os.environ['TERM']

# project specific code
env.Program(
	'bonsai',
	source = [
		'main.cpp',
		],
	LIBS=[
		'libopencv_core',
		'libopencv_highgui',
		])
