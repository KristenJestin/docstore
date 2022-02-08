using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;

namespace Docstore.App.Services
{
    public class FileWithoutDocumentFileBackgroundService : BackgroundService
    {
        private readonly ILogger<FileWithoutDocumentFileBackgroundService> _logger;
        private readonly IServiceScopeFactory _serviceScopeFactory;
        private readonly IWebHostEnvironment _hostingEnvironment;
        public FileWithoutDocumentFileBackgroundService(ILogger<FileWithoutDocumentFileBackgroundService> logger, IServiceScopeFactory serviceScopeFactory, IWebHostEnvironment hostingEnvironment)
        {
            _logger = logger;
            _serviceScopeFactory = serviceScopeFactory;
            _hostingEnvironment = hostingEnvironment;
        }

        protected async override Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _serviceScopeFactory.CreateScope();
                    var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

                    var paths = DocumentFile.StorePath.Prepend(_hostingEnvironment.ContentRootPath);
                    var filesPath = Path.Combine(paths.ToArray());
                    var files = new DirectoryInfo(filesPath).EnumerateFiles("*", SearchOption.TopDirectoryOnly);
                    var documentFiles = await context.DocumentFiles.ToListAsync(cancellationToken: stoppingToken);
                    var documentFilesName = documentFiles.Select(f => f.StoredName);

                    var filesToDelete = files.Where(f => !documentFilesName.Contains(f.Name));
                    foreach (var file in filesToDelete)
                    {
                        file.Delete();
                        _logger.LogInformation($"{nameof(FileWithoutDocumentFileBackgroundService)} : {nameof(ExecuteAsync)} : {file.Name} deleted => unused");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, $"{nameof(FileWithoutDocumentFileBackgroundService)} : {nameof(ExecuteAsync)}");
                }

                var delay = TimeSpan.FromHours(12);
                await Task.Delay((int)delay.TotalMilliseconds, stoppingToken);
            }
        }
    }
}
