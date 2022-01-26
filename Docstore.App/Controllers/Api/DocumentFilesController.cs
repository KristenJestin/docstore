using Docstore.App.Common.Extensions;
using Docstore.Application.Interfaces;
using Docstore.Application.Models;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Docstore.App.Controllers.Api
{
    [Route("api/[controller]")]
    [ApiController]
    public class DocumentFilesController : ControllerBase
    {
        private readonly IWebHostEnvironment _hostingEnvironment;
        private readonly AppSettings _appSettings;
        private readonly IDocumentFileRepository _repository;
        private readonly AppDbContext _context;

        public DocumentFilesController(IDocumentFileRepository repository, AppDbContext context, IWebHostEnvironment hostingEnvironment, IOptions<AppSettings> appSettings)
        {
            _repository = repository;
            _context = context;
            _hostingEnvironment = hostingEnvironment;
            _appSettings = appSettings.Value;
        }


        #region actions

        [HttpGet("{id}")]
        public async Task<ActionResult<DocumentFile>> Get(int id)
        {
            var file = await _repository.FindByIdAsync(id);

            if (file == null)
                return NotFound();

            // TODO: create and return dto
            return file;
        }

        [HttpPost]
        //[DisableRequestSizeLimit]
        public async Task<IActionResult> UploadFile(IFormFile file)
        {
            // model validation
            try
            {
                if (ModelState.IsValid && file != null)
                {
                    var documentFile = await file.UploadAndEncryptAndTransformToDocumentFileAsync(_hostingEnvironment, _appSettings.AppKey!);

                    // save in database
                    await _repository.AddAsync(documentFile);
                    await _context.SaveChangesAsync();

                    // response
                    return CreatedAtAction(nameof(Get), new { id = documentFile.Id }, documentFile);
                }
            }
            catch //(Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // is not supposed to get here
            return StatusCode(StatusCodes.Status500InternalServerError);
        }
        #endregion
    }
}
