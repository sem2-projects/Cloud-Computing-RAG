import React, { useState, useEffect } from 'react';
import { AlertCircle, Upload, Search, FileText, LogOut, Loader2 } from 'lucide-react';

const CONFIG = {
  cognito: {
    userPoolId: 'us-east-1_aHK6pqEZj',
    clientId: '613di8a74bt8soidh950ce1t9t',
    region: 'us-east-1'
  },
  api: {
    baseUrl: 'https://your-api-id.execute-api.us-east-1.amazonaws.com/prod'
  }
};
  api: {
    baseUrl: 'https://your-api-id.execute-api.us-east-1.amazonaws.com/prod' // Replace with your API Gateway URL
  }
;

// =============================================================================
// AWS Cognito Authentication Helper
// =============================================================================
class CognitoAuth {
  constructor(config) {
    this.userPoolId = config.userPoolId;
    this.clientId = config.clientId;
    this.region = config.region;
    this.cognitoUrl = `https://cognito-idp.${config.region}.amazonaws.com`;
  }

  async signUp(email, password) {
    const response = await fetch(this.cognitoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp'
      },
      body: JSON.stringify({
        ClientId: this.clientId,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }]
      })
    });
    return await response.json();
  }

  async confirmSignUp(email, code) {
    const response = await fetch(this.cognitoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmSignUp'
      },
      body: JSON.stringify({
        ClientId: this.clientId,
        Username: email,
        ConfirmationCode: code
      })
    });
    return await response.json();
  }

  async signIn(email, password) {
    const response = await fetch(this.cognitoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password
        }
      })
    });
    return await response.json();
  }

  async refreshToken(refreshToken) {
    const response = await fetch(this.cognitoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
      },
      body: JSON.stringify({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken
        }
      })
    });
    return await response.json();
  }
}

const auth = new CognitoAuth(CONFIG.cognito);

// =============================================================================
// Main App Component
// =============================================================================
export default function RAGApp() {
  const [user, setUser] = useState(null);
  const [authView, setAuthView] = useState('signin');
  const [view, setView] = useState('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Auth state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // Upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Query state
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState(null);

  // Documents state
  const [documents, setDocuments] = useState([]);

  // Check for existing session on mount
  useEffect(() => {
    const stored = localStorage.getItem('ragAuth');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
      } catch (e) {
        localStorage.removeItem('ragAuth');
      }
    }
  }, []);

  // Auto-clear messages
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // =============================================================================
  // Authentication Handlers
  // =============================================================================
  const handleSignUp = async () => {
    setError(null);
    setLoading(true);

    try {
      const result = await auth.signUp(email, password);
      if (result.UserSub) {
        setSuccess('Account created! Check your email for verification code.');
        setAwaitingConfirmation(true);
      } else if (result.__type) {
        setError(result.message || 'Sign up failed');
      }
    } catch (err) {
      setError(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSignUp = async () => {
    setError(null);
    setLoading(true);

    try {
      const result = await auth.confirmSignUp(email, confirmationCode);
      if (!result.__type) {
        setSuccess('Email verified! You can now sign in.');
        setAwaitingConfirmation(false);
        setAuthView('signin');
        setConfirmationCode('');
      } else {
        setError(result.message || 'Verification failed');
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);

    try {
      const result = await auth.signIn(email, password);
      if (result.AuthenticationResult) {
        const userData = {
          email,
          idToken: result.AuthenticationResult.IdToken,
          accessToken: result.AuthenticationResult.AccessToken,
          refreshToken: result.AuthenticationResult.RefreshToken
        };
        localStorage.setItem('ragAuth', JSON.stringify(userData));
        setUser(userData);
        setSuccess('Signed in successfully!');
      } else if (result.__type) {
        setError(result.message || 'Sign in failed');
      }
    } catch (err) {
      setError(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('ragAuth');
    setUser(null);
    setEmail('');
    setPassword('');
    setConfirmationCode('');
    setSuccess('Signed out successfully!');
  };

  // =============================================================================
  // API Helpers
  // =============================================================================
  const apiCall = async (endpoint, options = {}) => {
    if (!user) throw new Error('Not authenticated');

    const response = await fetch(`${CONFIG.api.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': user.idToken,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  };

  // =============================================================================
  // Upload Handler
  // =============================================================================
  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file');
      return;
    }

    setError(null);
    setLoading(true);
    setUploadProgress(0);

    try {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 50));
        }
      };

      const fileContent = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      setUploadProgress(60);

      const result = await apiCall('/upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: selectedFile.name,
          content: fileContent,
          contentType: selectedFile.type
        })
      });

      setUploadProgress(100);
      setSuccess(`File uploaded successfully! Document ID: ${result.documentId}`);
      setSelectedFile(null);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
      setTimeout(() => setUploadProgress(null), 2000);
    }
  };

  // =============================================================================
  // Query Handler
  // =============================================================================
  const handleQuery = async () => {
    if (!query.trim()) {
      setError('Please enter a query');
      return;
    }

    setError(null);
    setLoading(true);
    setQueryResult(null);

    try {
      const result = await apiCall('/query', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          topK: 5
        })
      });

      setQueryResult(result);
      setSuccess('Query completed successfully!');
    } catch (err) {
      setError(err.message || 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  // =============================================================================
  // Fetch Documents Handler
  // =============================================================================
  const handleFetchDocuments = async () => {
    setError(null);
    setLoading(true);

    try {
      const result = await apiCall('/documents', {
        method: 'GET'
      });

      setDocuments(result.documents || []);
      setSuccess('Documents loaded successfully!');
    } catch (err) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  // =============================================================================
  // Render Authentication Views
  // =============================================================================
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg shadow-2xl p-8 w-full max-w-md border border-gray-700">
          <h1 className="text-3xl font-bold text-white mb-6 text-center">
            RAG System
          </h1>

          {error && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-4 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {success && (
            <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded mb-4 text-sm">
              {success}
            </div>
          )}

          {awaitingConfirmation ? (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 mb-2">Verification Code</label>
                <input
                  type="text"
                  value={confirmationCode}
                  onChange={(e) => setConfirmationCode(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleConfirmSignUp()}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  placeholder="Enter 6-digit code"
                />
              </div>
              <button
                onClick={handleConfirmSignUp}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify Email'}
              </button>
            </div>
          ) : authView === 'signin' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSignIn()}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-gray-300 mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSignIn()}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <button
                onClick={handleSignIn}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <button
                onClick={() => setAuthView('signup')}
                className="w-full text-blue-400 hover:text-blue-300"
              >
                Need an account? Sign up
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                />
              </div>
              <div>
                <label className="block text-gray-300 mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  minLength={8}
                />
                <p className="text-gray-400 text-sm mt-1">
                  Min 8 chars, uppercase, lowercase, number
                </p>
              </div>
              <button
                onClick={handleSignUp}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded disabled:opacity-50"
              >
                {loading ? 'Creating account...' : 'Sign Up'}
              </button>
              <button
                onClick={() => setAuthView('signin')}
                className="w-full text-blue-400 hover:text-blue-300"
              >
                Already have an account? Sign in
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =============================================================================
  // Render Main Application
  // =============================================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">RAG System</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-300">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setView('upload')}
              className={`px-6 py-3 font-medium transition-colors ${
                view === 'upload'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Upload className="w-4 h-4 inline mr-2" />
              Upload
            </button>
            <button
              onClick={() => setView('query')}
              className={`px-6 py-3 font-medium transition-colors ${
                view === 'query'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Search className="w-4 h-4 inline mr-2" />
              Query
            </button>
            <button
              onClick={() => {
                setView('documents');
                handleFetchDocuments();
              }}
              className={`px-6 py-3 font-medium transition-colors ${
                view === 'documents'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <FileText className="w-4 h-4 inline mr-2" />
              Documents
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded mb-6 text-sm">
            {success}
          </div>
        )}

        {view === 'upload' && (
          <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
            <h2 className="text-2xl font-bold text-white mb-6">Upload Document</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-gray-300 mb-3 font-medium">
                  Select File
                </label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  accept=".pdf,.txt,.doc,.docx"
                  className="w-full text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer hover:file:bg-blue-700"
                />
                {selectedFile && (
                  <p className="text-gray-400 mt-2 text-sm">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              {uploadProgress !== null && (
                <div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-gray-400 text-sm mt-1">{uploadProgress}% complete</p>
                </div>
              )}

              <button
                onClick={handleUpload}
                disabled={loading || !selectedFile}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Upload Document
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {view === 'query' && (
          <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
            <h2 className="text-2xl font-bold text-white mb-6">Query Documents</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-gray-300 mb-3 font-medium">
                  Enter your question
                </label>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded text-white min-h-32"
                  placeholder="What would you like to know?"
                />
              </div>

              <button
                onClick={handleQuery}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    Search
                  </>
                )}
              </button>
            </div>

            {queryResult && (
              <div className="mt-8 space-y-6">
                <div className="bg-gray-700 rounded-lg p-6 border border-gray-600">
                  <h3 className="text-xl font-bold text-white mb-3">Answer</h3>
                  <p className="text-gray-200 leading-relaxed">{queryResult.answer}</p>
                </div>

                {queryResult.sources && queryResult.sources.length > 0 && (
                  <div>
                    <h3 className="text-xl font-bold text-white mb-4">Sources</h3>
                    <div className="space-y-3">
                      {queryResult.sources.map((source, idx) => (
                        <div key={idx} className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-blue-400 font-medium">{source.document}</span>
                            <span className="text-gray-400 text-sm">
                              Score: {(source.score * 100).toFixed(1)}%
                            </span>
                          </div>
                          <p className="text-gray-300 text-sm">{source.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {view === 'documents' && (
          <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
            <h2 className="text-2xl font-bold text-white mb-6">Your Documents</h2>
            
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : documents.length === 0 ? (
              <p className="text-gray-400 text-center py-12">
                No documents uploaded yet. Go to the Upload tab to add documents.
              </p>
            ) : (
              <div className="space-y-3">
                {documents.map((doc, idx) => (
                  <div key={idx} className="bg-gray-700 rounded-lg p-4 border border-gray-600 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-blue-400" />
                      <div>
                        <p className="text-white font-medium">{doc.filename}</p>
                        <p className="text-gray-400 text-sm">
                          Uploaded: {new Date(doc.uploadedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <span className="text-gray-400 text-sm">{doc.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}